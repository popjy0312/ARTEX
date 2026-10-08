package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func newWorkspaceTestServer(t *testing.T) (*Server, string, string) {
	t.Helper()
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Skipf("symlinks unsupported: %v", err)
	}
	return &Server{m: &Manager{dir: root}}, root, outside
}

func TestWorkspaceRejectsSymlinkEscapeForReadAndDelete(t *testing.T) {
	s, root, outside := newWorkspaceTestServer(t)

	read := httptest.NewRecorder()
	s.wsRead(read, httptest.NewRequest(http.MethodGet, "/api/workspace/read?path=escape/secret.txt", nil))
	if read.Code != http.StatusBadRequest {
		t.Fatalf("read through symlink status = %d, want 400", read.Code)
	}

	delete := httptest.NewRecorder()
	s.wsDelete(delete, httptest.NewRequest(http.MethodDelete, "/api/workspace/delete?path=escape/secret.txt", nil))
	if delete.Code != http.StatusBadRequest {
		t.Fatalf("delete through symlink status = %d, want 400", delete.Code)
	}
	if _, err := os.Stat(filepath.Join(outside, "secret.txt")); err != nil {
		t.Fatalf("outside file was affected by delete: %v", err)
	}
	if _, err := os.Lstat(filepath.Join(root, "escape")); err != nil {
		t.Fatalf("workspace symlink disappeared: %v", err)
	}

	download := httptest.NewRecorder()
	s.wsDownload(download, httptest.NewRequest(http.MethodGet, "/api/workspace/download?path=escape/secret.txt", nil))
	if download.Code != http.StatusBadRequest {
		t.Fatalf("download through symlink status = %d, want 400", download.Code)
	}
}

func TestWorkspaceRejectsSymlinkEscapeForWriteAndMkdir(t *testing.T) {
	s, _, outside := newWorkspaceTestServer(t)

	write := httptest.NewRecorder()
	s.wsWrite(write, httptest.NewRequest(http.MethodPost, "/api/workspace/write", bytes.NewReader(workspaceJSON(t, map[string]string{
		"path": "escape/new.txt", "content": "pwned",
	}))))
	if write.Code != http.StatusBadRequest {
		t.Fatalf("write through symlink status = %d, want 400", write.Code)
	}
	if _, err := os.Stat(filepath.Join(outside, "new.txt")); !os.IsNotExist(err) {
		t.Fatalf("write created outside file, stat err = %v", err)
	}

	mkdir := httptest.NewRecorder()
	s.wsMkdir(mkdir, httptest.NewRequest(http.MethodPost, "/api/workspace/mkdir", bytes.NewReader(workspaceJSON(t, map[string]string{
		"path": "escape/new-dir",
	}))))
	if mkdir.Code != http.StatusBadRequest {
		t.Fatalf("mkdir through symlink status = %d, want 400", mkdir.Code)
	}
	if _, err := os.Stat(filepath.Join(outside, "new-dir")); !os.IsNotExist(err) {
		t.Fatalf("mkdir created outside directory, stat err = %v", err)
	}
}

func TestWorkspaceRejectsLeafSymlinkOverwriteAndDelete(t *testing.T) {
	s, root, outside := newWorkspaceTestServer(t)
	if err := os.Symlink(filepath.Join(outside, "secret.txt"), filepath.Join(root, "alias.txt")); err != nil {
		t.Fatal(err)
	}

	write := httptest.NewRecorder()
	s.wsWrite(write, httptest.NewRequest(http.MethodPost, "/api/workspace/write", bytes.NewReader(workspaceJSON(t, map[string]string{
		"path": "alias.txt", "content": "overwritten",
	}))))
	if write.Code != http.StatusBadRequest {
		t.Fatalf("write to leaf symlink status = %d, want 400", write.Code)
	}
	data, err := os.ReadFile(filepath.Join(outside, "secret.txt"))
	if err != nil || string(data) != "outside" {
		t.Fatalf("outside file changed through leaf symlink: data=%q err=%v", data, err)
	}

	delete := httptest.NewRecorder()
	s.wsDelete(delete, httptest.NewRequest(http.MethodDelete, "/api/workspace/delete?path=alias.txt", nil))
	if delete.Code != http.StatusBadRequest {
		t.Fatalf("delete leaf symlink status = %d, want 400", delete.Code)
	}
	if _, err := os.Lstat(filepath.Join(root, "alias.txt")); err != nil {
		t.Fatalf("leaf symlink was removed: %v", err)
	}
}

func TestWorkspaceRootHandleSurvivesConfiguredPathReplacement(t *testing.T) {
	root := filepath.Join(t.TempDir(), "workspace")
	if err := os.Mkdir(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "stable.txt"), []byte("original"), 0o600); err != nil {
		t.Fatal(err)
	}
	s := &Server{m: &Manager{dir: root}}
	if _, err := s.workspaceRootHandle(); err != nil {
		t.Fatal(err)
	}

	moved := root + "-moved"
	if err := os.Rename(root, moved); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "stable.txt"), []byte("replacement"), 0o600); err != nil {
		t.Fatal(err)
	}

	read := httptest.NewRecorder()
	s.wsRead(read, httptest.NewRequest(http.MethodGet, "/api/workspace/read?path=stable.txt", nil))
	if read.Code != http.StatusOK {
		t.Fatalf("read after root replacement status = %d, want 200; body=%s", read.Code, read.Body.String())
	}
	var response struct {
		Content string `json:"content"`
	}
	if err := json.Unmarshal(read.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Content != "original" {
		t.Fatalf("read was redirected to replacement workspace: got %q", response.Content)
	}
}

func workspaceJSON(t *testing.T, value any) []byte {
	t.Helper()
	b, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
