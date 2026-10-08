package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestJWTKeyDirectoryMustStayOutsideWorkspace(t *testing.T) {
	workspace := t.TempDir()
	for _, keyDir := range []string{workspace, filepath.Join(workspace, "state")} {
		if _, err := loadOrCreateJWTKey(keyDir, workspace); err == nil {
			t.Fatalf("keyDir %q inside workspace was accepted", keyDir)
		}
	}
}

func TestJWTKeyMigrationAlwaysRemovesBrowsableLegacy(t *testing.T) {
	base := t.TempDir()
	workspace := filepath.Join(base, "data")
	keyDir := filepath.Join(base, "state")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(keyDir, 0o700); err != nil {
		t.Fatal(err)
	}
	active := strings.Repeat("a", 32)
	legacy := strings.Repeat("b", 32)
	if err := os.WriteFile(filepath.Join(keyDir, jwtKeyFilename), []byte(active), 0o644); err != nil {
		t.Fatal(err)
	}
	legacyPath := filepath.Join(workspace, jwtKeyFilename)
	if err := os.WriteFile(legacyPath, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := loadOrCreateJWTKey(keyDir, workspace)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != active {
		t.Fatalf("active key changed: got %q", got)
	}
	if _, err := os.Lstat(legacyPath); !os.IsNotExist(err) {
		t.Fatalf("legacy workspace key still exists: %v", err)
	}
	info, err := os.Stat(filepath.Join(keyDir, jwtKeyFilename))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("active key mode=%#o, want 0600", info.Mode().Perm())
	}
}

func TestJWTKeyRejectsSymlink(t *testing.T) {
	base := t.TempDir()
	workspace := filepath.Join(base, "data")
	keyDir := filepath.Join(base, "state")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(keyDir, 0o700); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(base, "target")
	if err := os.WriteFile(target, []byte(strings.Repeat("x", 32)), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(keyDir, jwtKeyFilename)); err != nil {
		t.Skipf("symlinks unsupported: %v", err)
	}
	if _, err := loadOrCreateJWTKey(keyDir, workspace); err == nil {
		t.Fatal("symlinked jwt key was accepted")
	}
}

func TestExtractTokenLimitsQueryCredentialsToSSE(t *testing.T) {
	const token = "query-secret"
	for _, tc := range []struct {
		name, method, path string
		want               string
	}{
		{"logs stream", http.MethodGet, "/api/logs/stream?token=" + token, token},
		{"update stream", http.MethodGet, "/api/update/stream?token=" + token, token},
		{"activity stream", http.MethodGet, "/api/exploration/activity/stream?task=1&token=" + token, token},
		{"side-question stream", http.MethodGet, "/api/side-questions/run-1/events?token=" + token, token},
		{"ordinary GET rejects query token", http.MethodGet, "/api/settings?token=" + token, ""},
		{"ordinary write rejects query token", http.MethodPost, "/api/settings?token=" + token, ""},
		{"SSE path rejects non-GET query token", http.MethodPost, "/api/update/stream?token=" + token, ""},
		{"side-question prefix alone is insufficient", http.MethodGet, "/api/side-questions/run-1?token=" + token, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(tc.method, tc.path, nil)
			if got := extractToken(r); got != tc.want {
				t.Fatalf("extractToken(%s %s)=%q, want %q", tc.method, tc.path, got, tc.want)
			}
		})
	}
}

func TestExtractTokenPrefersHeaderAndCookie(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/api/settings?token=query", nil)
	r.AddCookie(&http.Cookie{Name: "artex_token", Value: "cookie"})
	r.Header.Set("Authorization", "Bearer header")
	if got := extractToken(r); got != "header" {
		t.Fatalf("Authorization token=%q, want header", got)
	}
	r.Header.Del("Authorization")
	if got := extractToken(r); got != "cookie" {
		t.Fatalf("cookie token=%q, want cookie", got)
	}
}

// GetSetting 对"键不存在"和"读取出错"的返回值只差一个 error：两种情况 value 都是
// 空串。密码相关的 handler 一旦把 error 当成"还没设置密码"，就会在数据库抖动期间
// 敞开初始化入口——authInit 会放行一个未认证请求去覆盖已有的管理员密码，
// authStatus 则会把前端直接送到 /setup 去照着做这件事。
//
// 这两个测试把 handler 的连接池关掉来制造读取失败，断言两处都 fail closed。
func TestAuthStatusFailsClosedWhenDataSourceUnavailable(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Skipf("postgres unavailable (%v)", err)
	}
	defer m.Close()
	// 关掉池子，让后续 GetSetting 返回 error 而不是 sql.ErrNoRows。
	if err := m.pg.Close(); err != nil {
		t.Fatal(err)
	}

	s := &Server{m: m}
	w := httptest.NewRecorder()
	s.authStatus(w, httptest.NewRequest("GET", "/api/auth/status", nil))

	if w.Code != 503 {
		t.Fatalf("status=%d want 503 (读失败被当成未初始化会把用户送去 /setup 覆盖密码); body=%s", w.Code, w.Body.String())
	}
	var payload struct {
		Initialized *bool `json:"initialized"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err == nil && payload.Initialized != nil {
		t.Fatalf("读失败时不应回答 initialized，得到 %v", *payload.Initialized)
	}
}

func TestAuthInitFailsClosedWhenDataSourceUnavailable(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Skipf("postgres unavailable (%v)", err)
	}
	defer m.Close()
	if err := m.pg.Close(); err != nil {
		t.Fatal(err)
	}

	s := &Server{m: m}
	w := httptest.NewRecorder()
	body := strings.NewReader(`{"password":"correct horse battery"}`)
	s.authInit(w, httptest.NewRequest("POST", "/api/auth/init", body))

	if w.Code != 503 {
		t.Fatalf("status=%d want 503 (读失败时放行会让未认证请求覆盖已有密码); body=%s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "token") {
		t.Fatalf("读失败时不应签发 token: %s", w.Body.String())
	}
}

func TestValidatePassword(t *testing.T) {
	for _, tc := range []struct {
		name, pw string
		wantErr  bool
	}{
		{"空", "", true},
		{"七位", "1234567", true},
		{"八位", "12345678", false},
		{"八个汉字按字符数而非字节数计", "密码密码密码密码", false},
		{"三个汉字够 9 字节但只有 3 个字符", "密码强", true},
		{"72 字节", strings.Repeat("a", 72), false},
		{"73 字节超出 bcrypt 上限", strings.Repeat("a", 73), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := validatePassword(tc.pw); (got != "") != tc.wantErr {
				t.Fatalf("validatePassword(%q)=%q, wantErr=%v", tc.pw, got, tc.wantErr)
			}
		})
	}
}
