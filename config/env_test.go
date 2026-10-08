package config

import (
	"os"
	"slices"
	"testing"
)

func TestScrubSensitiveEnv(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "secret")
	t.Setenv("ARTEX_PG_PASSWORD", "secret")
	t.Setenv("HTTPS_PROXY", "http://user:pass@proxy.example")
	t.Setenv("FOO_API_KEY", "secret")
	t.Setenv("FOO_TOKEN", "secret")
	t.Setenv("DATABASE_URL", "postgres://user:pass@example/db")
	t.Setenv("PGPASSWORD", "secret")
	t.Setenv("PATH", os.Getenv("PATH"))

	removed := ScrubSensitiveEnv()
	for _, name := range []string{
		"ANTHROPIC_API_KEY", "ARTEX_PG_PASSWORD", "HTTPS_PROXY",
		"FOO_API_KEY", "FOO_TOKEN", "DATABASE_URL", "PGPASSWORD",
	} {
		if value := os.Getenv(name); value != "" {
			t.Fatalf("%s was not scrubbed", name)
		}
		if !slices.Contains(removed, name) {
			t.Fatalf("removed list does not contain %s: %v", name, removed)
		}
	}
	if _, ok := os.LookupEnv("PATH"); !ok {
		t.Fatal("PATH must be preserved")
	}
}
