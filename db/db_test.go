package db

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

type schemaExecFunc func(context.Context, string, ...any) (sql.Result, error)

func (f schemaExecFunc) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return f(ctx, query, args...)
}

func TestApplySchemaRetriesOnlyDeadlocks(t *testing.T) {
	deadlockAttempts := 0
	delays := []time.Duration{}
	err := applySchemaWithRetry(t.Context(), schemaExecFunc(func(context.Context, string, ...any) (sql.Result, error) {
		deadlockAttempts++
		if deadlockAttempts < 3 {
			return nil, &pgconn.PgError{Code: "40P01", Message: "deadlock detected"}
		}
		return nil, nil
	}), func(delay time.Duration) {
		delays = append(delays, delay)
	})
	if err != nil {
		t.Fatal(err)
	}
	if deadlockAttempts != 3 {
		t.Fatalf("schema attempts=%d, want 3", deadlockAttempts)
	}
	if len(delays) != 2 || delays[0] != schemaDeadlockRetryDelays[0] || delays[1] != schemaDeadlockRetryDelays[1] {
		t.Fatalf("schema retry delays=%v", delays)
	}

	nonRetryable := errors.New("permission denied")
	nonRetryableAttempts := 0
	err = applySchemaWithRetry(t.Context(), schemaExecFunc(func(context.Context, string, ...any) (sql.Result, error) {
		nonRetryableAttempts++
		return nil, nonRetryable
	}), func(time.Duration) {
		t.Fatal("non-deadlock error must not be retried")
	})
	if !errors.Is(err, nonRetryable) || nonRetryableAttempts != 1 {
		t.Fatalf("non-retryable result: attempts=%d err=%v", nonRetryableAttempts, err)
	}
}

func TestLegacyBuiltinAgentTextMatchesHEADSeedValues(t *testing.T) {
	legacy := legacyBuiltinAgentText("planner")
	if len(legacy) != 1 || legacy[0].name != "规划" || legacy[0].desc != "读取态势、判定目标，只在确有未覆盖的新方向时补充探索意图（每任务一个规划循环）。" {
		t.Fatalf("planner legacy text = %#v", legacy)
	}
	legacy = legacyBuiltinAgentText("mainagent")
	if len(legacy) != 1 || legacy[0].name != "主" || legacy[0].desc != "人机接口：观察进展，把人的意图落成 hint 或高优先级意图。" {
		t.Fatalf("mainagent legacy text = %#v", legacy)
	}
	if got := legacyBuiltinAgentText("unknown"); got != nil {
		t.Fatalf("unknown agent legacy text = %#v, want nil", got)
	}
}

func TestLegacyPromptVarTextMatchesHEADSeedValues(t *testing.T) {
	legacy := legacyPromptVarText("goals", "EngagementDescription")
	if len(legacy) != 1 || legacy[0].desc != "任务描述（测试对象/背景）" || legacy[0].example != "测试 example.com 站点" {
		t.Fatalf("goals prompt var legacy text = %#v", legacy)
	}
	legacy = legacyPromptVarText("worker", "ProxyAddr")
	if len(legacy) != 1 || legacy[0].desc != "记录代理地址(驱动 if 双文案)" || legacy[0].example != "127.0.0.1:8080" {
		t.Fatalf("worker prompt var legacy text = %#v", legacy)
	}
}

// testDSN returns the configured DSN, skipping the test when neither the env var
// nor a config file supplies one (DSN no longer has a built-in default).
func testDSN(t *testing.T) string {
	t.Helper()
	dsn, _, err := DSN()
	if err != nil {
		t.Skipf("no database config (%v) — skipping", err)
	}
	return dsn
}

// TestOpenSeed opens the live dev PG, applies schema, seeds, and verifies the
// builtin agents + their variable catalog exist. Skips if PG is unreachable.
func TestOpenSeed(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Skipf("postgres unavailable (%v) — skipping", err)
	}
	defer d.Close()

	wantAgents := len(builtinAgents)
	var agents int
	if err := d.QueryRow(`SELECT count(*) FROM agents WHERE builtin`).Scan(&agents); err != nil {
		t.Fatal(err)
	}
	if agents != wantAgents {
		t.Fatalf("want %d builtin agents, got %d", wantAgents, agents)
	}

	// planner should have at least its seeded catalog vars
	wantPlannerVars := 0
	for _, a := range builtinAgents {
		if a.key == "planner" {
			wantPlannerVars = len(a.vars)
			break
		}
	}
	var plannerVars int
	if err := d.QueryRow(`
SELECT count(*) FROM agent_prompt_vars v
JOIN agents a ON a.id = v.agent_id
WHERE a.key = 'planner'`).Scan(&plannerVars); err != nil {
		t.Fatal(err)
	}
	if plannerVars < wantPlannerVars {
		t.Fatalf("want at least %d planner vars, got %d", wantPlannerVars, plannerVars)
	}

	// re-open must be idempotent (no duplicate agents)
	d2, err := Open(testDSN(t))
	if err != nil {
		t.Fatal(err)
	}
	defer d2.Close()
	if err := d2.QueryRow(`SELECT count(*) FROM agents WHERE builtin`).Scan(&agents); err != nil {
		t.Fatal(err)
	}
	if agents != wantAgents {
		t.Fatalf("after re-open want %d agents, got %d", wantAgents, agents)
	}
}
