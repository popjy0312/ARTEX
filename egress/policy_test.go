package egress

import "testing"

func TestBlockedChinaLinkedDestinations(t *testing.T) {
	for _, raw := range []string{
		"https://registry.npmmirror.com/a.tgz",
		"https://api.deepseek.com/v1",
		"https://open.feishu.cn/open-apis/bot",
		"https://example.gov.cn/login",
	} {
		if err := CheckURL(raw); err == nil {
			t.Fatalf("expected %s to be blocked", raw)
		}
	}
}

func TestRejectsNonHTTPURL(t *testing.T) {
	if err := CheckURL("file:///etc/passwd"); err == nil {
		t.Fatal("expected non-HTTP URL to be rejected")
	}
}

func TestAllowsApprovedDestinations(t *testing.T) {
	for _, raw := range []string{
		"https://api.openai.com/v1",
		"https://api.anthropic.com",
		"https://registry.npmjs.org/pkg",
		"https://internal.example.kr/mcp",
	} {
		if err := CheckURL(raw); err != nil {
			t.Fatalf("expected %s to be allowed: %v", raw, err)
		}
	}
}
