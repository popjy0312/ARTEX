package server

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

// Workspace file manager — browse / view / edit / download / upload / delete the
// shared work dir (s.m.dir), where all agents write their artifacts. Every path is
// confined to the work dir root (traversal via ".." is neutralised). All routes sit
// behind requireAuth (see Handler()).

const (
	maxWorkspaceRead   = 2 << 20   // 2 MiB: files bigger than this aren't inlined for view/edit (download instead)
	maxWorkspaceUpload = 512 << 20 // 512 MiB per upload request
)

// wsResolve maps a user-supplied relative path to an absolute path INSIDE the work
// dir. It returns ok=false if the path would escape the root. filepath.Clean on a
// rooted copy collapses any ".." so nothing can climb above the root.
func (s *Server) wsResolve(rel string) (string, bool) {
	base := filepath.Clean(s.m.dir)
	rel = strings.TrimPrefix(strings.TrimSpace(rel), "/")
	clean := filepath.Clean("/" + rel) // e.g. "/a/../../etc" → "/etc" (still rooted at "/")
	abs := filepath.Clean(filepath.Join(base, clean))
	if abs != base && !strings.HasPrefix(abs, base+string(os.PathSeparator)) {
		return "", false
	}
	return abs, true
}

// wsResolveSecure performs the lexical workspace check used before opening an
// os.Root. Descriptor-relative Root operations below provide the actual
// traversal and symlink-race boundary.
func (s *Server) wsResolveSecure(rel string) (string, bool) {
	abs, ok := s.wsResolve(rel)
	if !ok {
		return "", false
	}
	return abs, true
}

func (s *Server) workspaceRootHandle() (*os.Root, error) {
	s.workspaceRootOnce.Do(func() {
		base := filepath.Clean(s.m.dir)
		info, err := os.Lstat(base)
		if err != nil {
			s.workspaceRootErr = err
			return
		}
		if info.Mode()&os.ModeSymlink != 0 {
			s.workspaceRootErr = os.ErrPermission
			return
		}
		s.workspaceRoot, s.workspaceRootErr = os.OpenRoot(base)
	})
	return s.workspaceRoot, s.workspaceRootErr
}

// wsRootPath converts a user path to a name relative to the workspace's stable
// directory handle. All subsequent operations must use Root methods: unlike an
// absolute path, a Root cannot be redirected outside it by a concurrent rename
// or symlink swap.
func (s *Server) wsRootPath(rel string) (*os.Root, string, string, bool) {
	abs, ok := s.wsResolveSecure(rel)
	if !ok {
		return nil, "", "", false
	}
	base := filepath.Clean(s.m.dir)
	name, err := filepath.Rel(base, abs)
	if err != nil {
		return nil, "", "", false
	}
	root, err := s.workspaceRootHandle()
	if err != nil {
		return nil, "", "", false
	}
	return root, filepath.Clean(name), abs, true
}

// wsHasSymlink rejects links for compatibility with the workspace API's
// existing behavior.  Root operations remain the security boundary: even if a
// component changes after this check, the operation cannot escape the Root.
func wsHasSymlink(root *os.Root, name string) bool {
	if name == "." {
		return false
	}
	part := "."
	for _, component := range strings.Split(name, string(os.PathSeparator)) {
		part = filepath.Join(part, component)
		if info, err := root.Lstat(part); err == nil && info.Mode()&os.ModeSymlink != 0 {
			return true
		}
	}
	return false
}

// wsRel renders an absolute path back as a workspace-relative path (forward slashes).
func (s *Server) wsRel(abs string) string {
	base := filepath.Clean(s.m.dir)
	rel, err := filepath.Rel(base, abs)
	if err != nil || rel == "." {
		return ""
	}
	return filepath.ToSlash(rel)
}

type wsEntry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	Dir   bool   `json:"dir"`
	Size  int64  `json:"size"`
	MTime int64  `json:"mtime"` // unix millis
}

// GET /api/workspace/list?path=<rel>
func (s *Server) wsList(w http.ResponseWriter, r *http.Request) {
	root, name, abs, ok := s.wsRootPath(r.URL.Query().Get("path"))
	if !ok {
		writeErr(w, 400, "非法路径")
		return
	}
	if wsHasSymlink(root, name) {
		writeErr(w, 400, "非法路径")
		return
	}
	fi, err := root.Stat(name)
	if err != nil {
		writeErr(w, 404, "路径不存在")
		return
	}
	if !fi.IsDir() {
		writeErr(w, 400, "不是目录")
		return
	}
	dir, err := root.Open(name)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer dir.Close()
	ents, err := dir.ReadDir(-1)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	out := make([]wsEntry, 0, len(ents))
	for _, e := range ents {
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, wsEntry{
			Name:  e.Name(),
			Path:  s.wsRel(filepath.Join(abs, e.Name())),
			Dir:   e.IsDir(),
			Size:  info.Size(),
			MTime: info.ModTime().UnixMilli(),
		})
	}
	// 目录在前，各自按名称排序。
	sort.Slice(out, func(i, j int) bool {
		if out[i].Dir != out[j].Dir {
			return out[i].Dir
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	writeJSON(w, 200, map[string]any{"path": s.wsRel(abs), "entries": out})
}

// GET /api/workspace/read?path=<rel> — inline text for view/edit. Binary or oversize
// files return {binary:true}/{too_large:true} with no content (use download instead).
func (s *Server) wsRead(w http.ResponseWriter, r *http.Request) {
	root, name, abs, ok := s.wsRootPath(r.URL.Query().Get("path"))
	if !ok {
		writeErr(w, 400, "非法路径")
		return
	}
	if wsHasSymlink(root, name) {
		writeErr(w, 400, "非法路径")
		return
	}
	f, err := root.Open(name)
	if err != nil {
		writeErr(w, 404, "文件不存在")
		return
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		writeErr(w, 404, "文件不存在")
		return
	}
	if fi.IsDir() {
		writeErr(w, 400, "是目录，不能作为文件读取")
		return
	}
	if fi.Size() > maxWorkspaceRead {
		writeJSON(w, 200, map[string]any{"path": s.wsRel(abs), "size": fi.Size(), "too_large": true, "binary": true})
		return
	}
	data, err := io.ReadAll(f)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if bytes.IndexByte(data, 0) >= 0 || !utf8.Valid(data) {
		writeJSON(w, 200, map[string]any{"path": s.wsRel(abs), "size": fi.Size(), "binary": true})
		return
	}
	writeJSON(w, 200, map[string]any{"path": s.wsRel(abs), "size": fi.Size(), "binary": false, "content": string(data)})
}

// POST /api/workspace/write  {path, content} — create/overwrite a text file.
func (s *Server) wsWrite(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	root, name, abs, ok := s.wsRootPath(req.Path)
	if !ok || name == "." {
		writeErr(w, 400, "非法路径")
		return
	}
	if wsHasSymlink(root, name) {
		writeErr(w, 400, "非法路径")
		return
	}
	if fi, err := root.Stat(name); err == nil && fi.IsDir() {
		writeErr(w, 400, "目标是目录")
		return
	}
	if err := root.MkdirAll(filepath.Dir(name), 0o755); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if err := root.WriteFile(name, []byte(req.Content), 0o644); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "path": s.wsRel(abs)})
}

// POST /api/workspace/mkdir  {path}
func (s *Server) wsMkdir(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	root, name, abs, ok := s.wsRootPath(req.Path)
	if !ok || name == "." {
		writeErr(w, 400, "非法路径")
		return
	}
	if wsHasSymlink(root, name) {
		writeErr(w, 400, "非法路径")
		return
	}
	if err := root.MkdirAll(name, 0o755); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "path": s.wsRel(abs)})
}

// DELETE /api/workspace/delete?path=<rel> — removes a file or a directory tree
// (confined to the work dir; the root itself can't be deleted).
func (s *Server) wsDelete(w http.ResponseWriter, r *http.Request) {
	root, name, _, ok := s.wsRootPath(r.URL.Query().Get("path"))
	if !ok {
		writeErr(w, 400, "非法路径")
		return
	}
	if name == "." {
		writeErr(w, 400, "不能删除工作区根目录")
		return
	}
	if wsHasSymlink(root, name) {
		writeErr(w, 400, "非法路径")
		return
	}
	if _, err := root.Stat(name); err != nil {
		writeErr(w, 404, "路径不存在")
		return
	}
	if err := root.RemoveAll(name); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// GET /api/workspace/download?path=<rel> — stream a file as an attachment.
func (s *Server) wsDownload(w http.ResponseWriter, r *http.Request) {
	root, name, abs, ok := s.wsRootPath(r.URL.Query().Get("path"))
	if !ok {
		writeErr(w, 400, "非法路径")
		return
	}
	if wsHasSymlink(root, name) {
		writeErr(w, 400, "非法路径")
		return
	}
	f, err := root.Open(name)
	if err != nil {
		writeErr(w, 404, "文件不存在")
		return
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil || fi.IsDir() {
		writeErr(w, 404, "文件不存在")
		return
	}
	fileName := filepath.Base(abs)
	// RFC 5987 filename* keeps non-ASCII names intact; plain filename is the fallback.
	w.Header().Set("Content-Disposition", "attachment; filename=\""+sanitizeFilename(fileName)+"\"; filename*=UTF-8''"+url.PathEscape(fileName))
	http.ServeContent(w, r, fileName, fi.ModTime(), f)
}

// POST /api/workspace/upload?path=<dir> — multipart form field "file" (one or more).
func (s *Server) wsUpload(w http.ResponseWriter, r *http.Request) {
	root, dirName, _, ok := s.wsRootPath(r.URL.Query().Get("path"))
	if !ok {
		writeErr(w, 400, "非法路径")
		return
	}
	if wsHasSymlink(root, dirName) {
		writeErr(w, 400, "非法路径")
		return
	}
	if fi, err := root.Stat(dirName); err != nil || !fi.IsDir() {
		writeErr(w, 400, "目标目录不存在")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxWorkspaceUpload)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeErr(w, 400, "解析上传失败或超出大小限制："+err.Error())
		return
	}
	files := r.MultipartForm.File["file"]
	if len(files) == 0 {
		writeErr(w, 400, "缺少上传文件(表单字段 file)")
		return
	}
	saved := 0
	for _, hdr := range files {
		name := filepath.Base(hdr.Filename) // strip any path component
		if name == "" || name == "." || name == ".." {
			continue
		}
		destName := filepath.Join(dirName, name)
		if wsHasSymlink(root, destName) {
			continue
		}
		if err := saveWorkspaceUpload(root, destName, hdr); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		saved++
	}
	writeJSON(w, 200, map[string]any{"uploaded": saved})
}

func saveWorkspaceUpload(root *os.Root, dest string, hdr *multipart.FileHeader) error {
	src, err := hdr.Open()
	if err != nil {
		return err
	}
	defer src.Close()
	out, err := root.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, src)
	return err
}

// saveUpload is retained for the chat upload handler, whose destination is
// already selected by that handler and is outside the workspace API.
func saveUpload(hdr *multipart.FileHeader, dest string) error {
	src, err := hdr.Open()
	if err != nil {
		return err
	}
	defer src.Close()
	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, src)
	return err
}

// sanitizeFilename strips characters unsafe for a Content-Disposition filename token.
func sanitizeFilename(name string) string {
	name = strings.ReplaceAll(name, "\"", "")
	name = strings.ReplaceAll(name, "\\", "")
	name = strings.ReplaceAll(name, "\n", "")
	name = strings.ReplaceAll(name, "\r", "")
	return name
}
