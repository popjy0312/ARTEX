// Package db is the PostgreSQL data source for ARTEX (取代旧 graph 单文件 SQLite)。
// 它打开连接、应用 schema、并 seed 内置 agent 与变量目录。
package db

import (
	"context"
	"database/sql"
	_ "embed"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/Autumn-27/artex/config"
	"github.com/jackc/pgx/v5/pgconn"
	_ "github.com/jackc/pgx/v5/stdlib" // pgx database/sql driver ("pgx")
)

//go:embed schema.sql
var schemaSQL string

const schemaMigrationLockKey int64 = 7337741001

// maxOpenConns 是连接池上限，见 Open 里的说明。取值远低于 PostgreSQL 默认的
// max_connections=100，同时远高于应用自身的嵌套取连接深度（启动期的 schema
// advisory lock 会在持有一条连接的同时让 seedBuiltins 另取连接），不会自锁。
const maxOpenConns = 32

var schemaDeadlockRetryDelays = [...]time.Duration{
	100 * time.Millisecond,
	250 * time.Millisecond,
	500 * time.Millisecond,
	time.Second,
}

type schemaExecer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func isPostgresDeadlock(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "40P01"
}

func applySchemaWithRetry(ctx context.Context, execer schemaExecer, sleep func(time.Duration)) error {
	for attempt := 0; ; attempt++ {
		if _, err := execer.ExecContext(ctx, schemaSQL); err != nil {
			if !isPostgresDeadlock(err) || attempt >= len(schemaDeadlockRetryDelays) {
				return err
			}
			sleep(schemaDeadlockRetryDelays[attempt])
			continue
		}
		return nil
	}
}

// withSchemaMigrationLock pins the session-level lock to one checked-out
// connection. Running pg_advisory_lock through *sql.DB is incorrect because a
// later schema or unlock call may use a different pooled PostgreSQL session.
func withSchemaMigrationLock(ctx context.Context, sqlDB *sql.DB, action func(*sql.Conn) error) (err error) {
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `SELECT pg_advisory_lock($1)`, schemaMigrationLockKey); err != nil {
		return fmt.Errorf("advisory lock: %w", err)
	}
	defer func() {
		if _, unlockErr := conn.ExecContext(context.Background(), `SELECT pg_advisory_unlock($1)`, schemaMigrationLockKey); unlockErr != nil && err == nil {
			err = fmt.Errorf("advisory unlock: %w", unlockErr)
		}
	}()
	return action(conn)
}

// coordinateWithSchemaMigration makes long, multi-table archive transactions
// mutually exclusive with startup DDL while allowing ordinary runtime queries
// to continue normally.
func coordinateWithSchemaMigration(tx *sql.Tx) error {
	if _, err := tx.Exec(`SELECT pg_advisory_xact_lock($1)`, schemaMigrationLockKey); err != nil {
		return fmt.Errorf("coordinate with schema migration: %w", err)
	}
	return nil
}

// DSN resolves the PostgreSQL connection string and reports where it came from.
// Precedence: env ARTEX_PG_DSN > config file (config.json). There is no
// built-in default — it errors if neither source is configured.
func DSN() (dsn, source string, err error) {
	return config.PostgresDSN()
}

// DB wraps the shared *sql.DB. PG handles its own connection pool + concurrency
// (MVCC), so unlike the old SQLite store there is no process-wide write mutex.
type DB struct{ *sql.DB }

// ensureDatabase connects to the postgres system database and creates the target
// database if it does not exist. dsn must be a postgres:// URL.
func ensureDatabase(dsn string) error {
	u, err := url.Parse(dsn)
	if err != nil {
		return nil // unparseable DSN — let the normal Open fail with a clear error
	}
	dbName := strings.TrimPrefix(u.Path, "/")
	if dbName == "" || dbName == "postgres" {
		return nil
	}
	// connect to the postgres maintenance database instead
	adminDSN := *u
	adminDSN.Path = "/postgres"
	admin, err := sql.Open("pgx", adminDSN.String())
	if err != nil {
		return nil // best-effort; let Open surface the real error
	}
	defer admin.Close()
	if err := admin.Ping(); err != nil {
		return nil
	}
	var exists bool
	_ = admin.QueryRow(`SELECT true FROM pg_database WHERE datname=$1`, dbName).Scan(&exists)
	if !exists {
		if _, err := admin.Exec(`CREATE DATABASE "` + dbName + `"`); err != nil {
			return fmt.Errorf("create database %q: %w", dbName, err)
		}
	}
	return nil
}

// Open connects, applies the schema (idempotent), and seeds builtin rows.
func Open(dsn string) (*DB, error) {
	if err := ensureDatabase(dsn); err != nil {
		return nil, err
	}
	sqlDB, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	// database/sql 默认不限制连接数：池里没有空闲连接时会无条件新建，一路顶到
	// PostgreSQL 的 max_connections（默认 100）才被拒，于是高峰期的查询拿到的是
	// `FATAL: sorry, too many clients already` 这种**错误**。封顶之后超额查询改为
	// 排队等待空闲连接——同样的负载下变成变慢而不是报错，调用方不必再去区分
	// "读不到"和"没有"。maxOpenConns 要留出余量给 psql / reset-password.sh 以及
	// 可能并存的其他实例；若 max_connections 调低过，这里也要跟着往下调。
	sqlDB.SetMaxOpenConns(maxOpenConns)
	sqlDB.SetMaxIdleConns(maxOpenConns)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)
	sqlDB.SetConnMaxIdleTime(5 * time.Minute)
	if err := sqlDB.Ping(); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("ping postgres (%s): %w", config.Redact(dsn), err)
	}
	d := &DB{sqlDB}
	// pgx runs multi-statement Exec via the simple protocol when there are no args.
	// Keep the dedicated lock connection checked out until both DDL and seeding
	// finish so concurrent application instances cannot initialize out of order.
	err = withSchemaMigrationLock(context.Background(), sqlDB, func(conn *sql.Conn) error {
		if err := applySchemaWithRetry(context.Background(), conn, time.Sleep); err != nil {
			return fmt.Errorf("apply schema: %w", err)
		}
		if err := d.seedBuiltins(); err != nil {
			return fmt.Errorf("seed builtins: %w", err)
		}
		return nil
	})
	if err != nil {
		sqlDB.Close()
		return nil, err
	}
	return d, nil
}

// builtinAgent describes one of the fixed agents and its prompt-variable catalog.
type builtinAgent struct {
	key, name, role, desc string
	vars                  []promptVar
	interactiveShell      bool // 建行时的默认交互式 shell 开关；ON CONFLICT 不覆盖用户后续手动开关
	runSeconds            *int // 建行时的单次 run 墙钟上限(秒)；nil=用种子默认(1200)，0=不限时
}

type promptVar struct{ name, desc, example, source string }

// intp 返回 v 的指针，用于给 builtinAgent 可选字段(如 runSeconds)显式取值。
func intp(v int) *int { return &v }

// builtinAgents mirrors docs §5(a). 内置工具不入库；这里只 seed agent + 变量目录。
// 注：planner/worker/mainagent/auto 的交互式 shell 默认由下方 interactive_shell_default_v1
// 块统一置 true（尊重后续 toggle）；这里的 interactiveShell 只给需要「建行即默认开」的新 agent。
var builtinAgents = []builtinAgent{
	{"goals", "목표 분해", "goals", "참여 목표를 독립적이고 검증 가능한 하위 목표로 분해합니다.", []promptVar{
		{"EngagementDescription", "참여 설명(대상/배경)", "example.com 사이트를 테스트합니다", "exploration"},
		// Now 是全局 runtime 变量(见 server.globalPromptVars),不再在各 agent 目录里
		// 重复定义,否则 withGlobalVars 追加时会与全局项撞名。
	}, false, nil},
	{"planner", "플래너", "planner", "상황을 읽고 목표를 평가하며, 실제로 다루지 않은 방향이 있을 때만 탐색 의도를 추가합니다(작업당 한 번의 계획 루프).", []promptVar{
		{"Goal", "전체 작업 목표", "example.com에서 관리자 권한을 획득합니다", "exploration"},
		{"AssetSummary", "자산 수/유형 요약(선택)", "도메인:3 IP:5 사이트:2", "distilled"},
	}, false, nil},
	{"mainagent", "메인", "main", "진행 상황을 확인하고 사용자의 의도를 힌트 또는 높은 우선순위 의도로 전환하는 사용자 인터페이스입니다.", []promptVar{
		{"Goal", "현재 작업 목표", "example.com에서 관리자 권한을 획득합니다", "exploration"},
		{"AssetSummary", "초기 상황 요약(선택)", "도메인:3 IP:5", "distilled"},
		{"FindingsSummary", "확인된 취약점 요약(선택)", "high:1 medium:2", "distilled"},
	}, false, nil},
	{"worker", "워커", "worker", "하나의 의도를 맡아 실행하고 발견한 사실/취약점을 지식 그래프에 기록한 뒤 중지합니다.", []promptVar{
		{"ProxyAddr", "기록 프록시 주소(if 문구 분기용)", "127.0.0.1:8080", "runtime"},
		{"WorkerName", "Worker 식별자(선택)", "worker-1", "runtime"},
	}, false, nil},
	// Auto:内置「平台操作」agent。不参与渗透编排循环,经对话页驱动,用工具操作平台。
	{"auto", "오토", "assistant", "플랫폼 운영 보조: 승인된 도구로 작업과 자산을 관리합니다. 실행 가능한 Skill, custom tool, MCP 구성은 관리자 전용입니다.", nil, false, nil},
	// 渗透测试:内置「独立渗透」agent。经对话页驱动,一人从侦察到收尾走完整条渗透链,自己规划自己执行自己验证。默认开启交互式 shell。
	{"pentest", "침투 테스트", "assistant", "독립 침투 테스트 Agent: 정찰부터 공격면 탐색, 악용, 검증, 마무리까지 스스로 계획·실행·대항 검증합니다.", nil, true, intp(0)},
}

type legacyAgentText struct{ name, desc string }
type legacyVarText struct{ desc, example string }

// These are exact values shipped by older releases. They are migration inputs,
// not fallbacks: customized rows must never be overwritten.
func legacyBuiltinAgentText(key string) []legacyAgentText {
	legacy := map[string][]legacyAgentText{
		"goals":     {{"目标拆解", "把渗透任务目标拆解成若干独立、可验证的子目标。"}},
		"planner":   {{"规划", "读取态势、判定目标，只在确有未覆盖的新方向时补充探索意图（每任务一个规划循环）。"}},
		"mainagent": {{"主", "人机接口：观察进展，把人的意图落成 hint 或高优先级意图。"}},
		"worker":    {{"执行", "领取一条意图执行，把发现的事实/漏洞写回知识图谱后停止。"}},
		"auto":      {{"Auto", "平台操作助手：用工具管理任务(建/看/暂停/给提示)与资产，并可创建/修改 skill、自定义工具、MCP。"}},
		"pentest":   {{"渗透测试", "独立渗透 agent：一人从侦察→找攻击面→深入利用→验证→收尾走完整条链，自己规划、自己执行、自己对抗式验证。"}},
	}
	return legacy[key]
}

func legacyPromptVarText(agentKey, varName string) []legacyVarText {
	key := agentKey + ":" + varName
	legacy := map[string][]legacyVarText{
		"goals:EngagementDescription": {{"任务描述（测试对象/背景）", "测试 example.com 站点"}},
		"planner:Goal":                {{"任务总目标", "拿下 example.com 的管理员权限"}},
		"planner:AssetSummary":        {{"资产计数/类型分布摘要(可选)", "domain:3 ip:5 site:2"}},
		"mainagent:Goal":              {{"当前任务目标", "拿下 example.com 的管理员权限"}},
		"mainagent:AssetSummary":      {{"开局态势摘要(可选)", "domain:3 ip:5"}},
		"mainagent:FindingsSummary":   {{"已确认漏洞摘要(可选)", "high:1 medium:2"}},
		"worker:ProxyAddr":            {{"记录代理地址(驱动 if 双文案)", "127.0.0.1:8080"}},
		"worker:WorkerName":           {{"worker 自我标识(可选)", "worker-1"}},
	}
	return legacy[key]
}

// seedBuiltins inserts the fixed built-in agents and their variable catalog (idempotent).
func (d *DB) seedBuiltins() error {
	for _, a := range builtinAgents {
		_, err := d.Exec(`
INSERT INTO agents(key, name, description, role, builtin, enabled, interactive_shell, run_seconds)
VALUES ($1, $2, NULLIF($3,''), $4, true, true, $5, COALESCE($6, 1200))

ON CONFLICT (key) DO NOTHING`, a.key, a.name, a.desc, a.role, a.interactiveShell, a.runSeconds)
		if err != nil {
			return fmt.Errorf("agent %s: %w", a.key, err)
		}
		var agentID int64
		if err := d.QueryRow(`SELECT id FROM agents WHERE key=$1`, a.key).Scan(&agentID); err != nil {
			return fmt.Errorf("agent %s lookup: %w", a.key, err)
		}
		// Migrate only exact shipped legacy values. Any user-edited name or
		// description is intentionally preserved.
		for _, legacy := range legacyBuiltinAgentText(a.key) {
			if _, err := d.Exec(`UPDATE agents SET name=$2, description=$3 WHERE key=$1 AND name=$4 AND COALESCE(description,'')=$5`, a.key, a.name, a.desc, legacy.name, legacy.desc); err != nil {
				return fmt.Errorf("migrate agent %s text: %w", a.key, err)
			}
		}
		for _, v := range a.vars {
			if _, err := d.Exec(`
INSERT INTO agent_prompt_vars(agent_id, var_name, description, example, source)
VALUES ($1, $2, $3, $4, $5)

ON CONFLICT (agent_id, var_name) DO NOTHING`,
				agentID, v.name, v.desc, v.example, v.source); err != nil {
				return fmt.Errorf("agent %s var %s: %w", a.key, v.name, err)
			}
			for _, legacy := range legacyPromptVarText(a.key, v.name) {
				if _, err := d.Exec(`UPDATE agent_prompt_vars SET description=$3, example=$4, source=$5 WHERE agent_id=$1 AND var_name=$2 AND description=$6 AND example=$7`, agentID, v.name, v.desc, v.example, v.source, legacy.desc, legacy.example); err != nil {
					return fmt.Errorf("migrate agent %s var %s: %w", a.key, v.name, err)
				}
			}
		}
	}
	// Drop catalog entries for variables that were renamed, so the white-list no
	// longer advertises a name templates can't resolve (EngagementTitle→Description).
	// 'Now' 从各 agent 目录提升为全局 runtime 变量后,旧库里 goals 仍残留一条 'Now'
	// 会与全局项撞名(前端变量列表 key 重复);一并清掉。
	if _, err := d.Exec(`DELETE FROM agent_prompt_vars WHERE var_name IN ('EngagementTitle', 'CoverageGaps', 'Now')`); err != nil {
		return fmt.Errorf("cleanup renamed vars: %w", err)
	}
	// Default-on interactive_shell for the runtime agents (planner/worker/mainagent/auto)
	// ONCE — respects a later user toggle-off (guarded by a settings flag). goals(one-shot
	// decomposer) stays off. Runs after the column exists (schema applied before seed).
	if v, _, _ := d.GetSetting("interactive_shell_default_v1"); v != "true" {
		if _, err := d.Exec(`UPDATE agents SET interactive_shell=true WHERE key IN ('planner','worker','mainagent','auto')`); err != nil {
			return fmt.Errorf("seed interactive_shell defaults: %w", err)
		}
		_ = d.SetSetting("interactive_shell_default_v1", "true")
	}
	// Seed the built-in browser (Playwright) MCP once — DISABLED by default (用户
	// 需要时自行启用), no proxy by default. The traffic-capture toggle injects/strips
	// the recording proxy + CA at runtime (server.Manager.syncBrowserMCPProxy).
	// Insert only if absent so we never clobber user edits (args/env/enabled/
	// visibility) on restart.
	if _, err := d.Exec(`
INSERT INTO mcp_servers(name, transport, command, args, env, enabled)
VALUES ('browser', 'stdio', 'npx', $1, '{}', false)
ON CONFLICT (name) DO NOTHING`,
		`["@playwright/mcp","--headless"]`); err != nil {
		return fmt.Errorf("seed browser mcp: %w", err)
	}
	// NOTE: the placeholder ScopeSentry data-source MCP (empty URL + empty X-API-Key,
	// disabled) is seeded directly in schema.sql §F so a raw `psql < schema.sql` init
	// also gets it. schema.sql is Exec'd on every startup, so it stays idempotent.
	if err := d.seedBuiltinSkillVisibility(); err != nil {
		return fmt.Errorf("seed skill visibility: %w", err)
	}
	// Network-capable shipped skills are opt-in after the egress hardening
	// migration. This also disables visibility rows created by older releases.
	if v, _, _ := d.GetSetting("network_skill_opt_in_v1"); v != "done" {
		if _, err := d.Exec(`UPDATE agent_skill_visibility SET enabled=false WHERE skill_name IN ('api-recon','playwright-cli','scopesentry')`); err != nil {
			return fmt.Errorf("disable network-capable skill defaults: %w", err)
		}
		_ = d.SetSetting("network_skill_opt_in_v1", "done")
	}
	if v, _, _ := d.GetSetting("auto_shell_disable_v1"); v != "done" {
		if _, err := d.Exec(`UPDATE agents SET interactive_shell=false WHERE key='auto'`); err != nil {
			return fmt.Errorf("disable Auto agent shell: %w", err)
		}
		_ = d.SetSetting("auto_shell_disable_v1", "done")
	}
	if v, _, _ := d.GetSetting("china_notification_disable_v1"); v != "done" {
		if _, err := d.Exec(`UPDATE notification_channels SET enabled=false WHERE kind IN ('dingtalk','feishu','wecom')`); err != nil {
			return fmt.Errorf("disable China-operated notification channels: %w", err)
		}
		_ = d.SetSetting("china_notification_disable_v1", "done")
	}
	if err := d.seedDefaultInterceptRules(); err != nil {
		return fmt.Errorf("seed intercept rules: %w", err)
	}
	if err := d.seedDefaultInterceptRulesV2(); err != nil {
		return fmt.Errorf("seed intercept rules v2: %w", err)
	}
	if err := d.seedDefaultInterceptRulesV3(); err != nil {
		return fmt.Errorf("seed intercept rules v3: %w", err)
	}
	if err := d.seedDefaultAssetInterceptRules(); err != nil {
		return fmt.Errorf("seed asset intercept rules: %w", err)
	}
	return nil
}

// seedDefaultAssetInterceptRules inserts the built-in asset blocklist (fuzzy
// domain matches for government / education sites) once on first startup. Gated
// by a settings flag so a user's later disable/delete is never resurrected on
// restart — same policy as the intercept-rule seed.
func (d *DB) seedDefaultAssetInterceptRules() error {
	// Exact legacy-note migration keeps existing user edits untouched.
	legacyNotes := map[string]string{
		"[内置] 政府网站 (.gov)":                          "[기본 제공] 정부 웹사이트(.gov)",
		"[内置] 政府网站 (.gov.cn)":                       "[기본 제공] 정부 웹사이트(.gov.cn)",
		"[内置] 教育网站 (.edu)":                          "[기본 제공] 교육 웹사이트(.edu)",
		"[内置] 教育网站 (.edu.cn)":                       "[기본 제공] 교육 웹사이트(.edu.cn)",
		"[Built-in] Government websites (.gov)":     "[기본 제공] 정부 웹사이트(.gov)",
		"[Built-in] Government websites (.gov.cn)":  "[기본 제공] 정부 웹사이트(.gov.cn)",
		"[Built-in] Educational websites (.edu)":    "[기본 제공] 교육 웹사이트(.edu)",
		"[Built-in] Educational websites (.edu.cn)": "[기본 제공] 교육 웹사이트(.edu.cn)",
	}
	for old, korean := range legacyNotes {
		if _, err := d.Exec(`UPDATE asset_intercept_rules SET note=$2 WHERE note=$1 AND builtin=true`, old, korean); err != nil {
			return fmt.Errorf("migrate asset rule text: %w", err)
		}
	}
	if v, _, _ := d.GetSetting("asset_intercept_default_rules_v1"); v == "done" {
		return nil
	}
	rules := []struct {
		kind    string
		pattern string
		note    string
	}{
		{"fuzzy_domain", ".gov", "[기본 제공] 정부 웹사이트(.gov)"},
		{"fuzzy_domain", ".gov.cn", "[기본 제공] 정부 웹사이트(.gov.cn)"},
		{"fuzzy_domain", ".edu", "[기본 제공] 교육 웹사이트(.edu)"},
		{"fuzzy_domain", ".edu.cn", "[기본 제공] 교육 웹사이트(.edu.cn)"},
	}
	for _, r := range rules {
		if _, err := d.Exec(`
INSERT INTO asset_intercept_rules(enabled, kind, pattern, note, builtin)
SELECT true, $1, $2, $3, true
WHERE NOT EXISTS (
  SELECT 1 FROM asset_intercept_rules WHERE kind=$1 AND pattern=$2
)`, r.kind, r.pattern, r.note); err != nil {
			return fmt.Errorf("asset rule %q: %w", r.pattern, err)
		}
	}
	return d.SetSetting("asset_intercept_default_rules_v1", "done")
}

// builtinSkillVisibility maps a shipped skill's directory name → the built-in
// agent keys that should see it by default. The skill FILES themselves live on the
// filesystem (SkillDir, loaded by norma at runtime); DB only carries this visibility
// binding. Skills omitted here (e.g. playwright-cli, scopesentry) ship invisible by
// default — the user turns them on per-agent when needed. scopesentry additionally
// declares `mcps: ScopeSentry`, which only takes effect once it's made visible and
// that MCP is enabled/configured.
var builtinSkillVisibility = map[string][]string{}

// seedBuiltinSkillVisibility binds the shipped built-in skills to their default
// agents. Insert-if-absent (ON CONFLICT DO NOTHING) so a user's later toggle-off is
// never resurrected on restart — matches the browser-MCP / intercept-rule seed policy.
func (d *DB) seedBuiltinSkillVisibility() error {
	for skillName, agentKeys := range builtinSkillVisibility {
		for _, key := range agentKeys {
			if _, err := d.Exec(`
INSERT INTO agent_skill_visibility(agent_id, skill_name, enabled)
SELECT id, $2, true FROM agents WHERE key=$1
ON CONFLICT (agent_id, skill_name) DO NOTHING`, key, skillName); err != nil {
				return fmt.Errorf("skill %s → agent %s: %w", skillName, key, err)
			}
		}
	}
	return nil
}

// migrateLegacyInterceptText updates only exact shipped name/message pairs.
// A rule that a user renamed or edited is deliberately left untouched.
func (d *DB) migrateLegacyInterceptText() error {
	type pair struct{ oldName, newName, oldMessage, newMessage string }
	pairs := []pair{
		// Chinese values were the original shipped seed text in HEAD. Keep
		// these entries alongside the English values from intermediate builds
		// so upgrades from either persisted form are handled exactly once.
		{"[内置] 递归强制删除 rm -rf", "[기본 제공] rm -rf 재귀 강제 삭제", "禁止执行递归强制删除（rm -rf / rm --recursive），可能永久损坏系统或靶机环境", "재귀 강제 삭제(rm -rf / rm --recursive)는 시스템 또는 대상 환경을 영구적으로 손상할 수 있어 금지됩니다"},
		{"[内置] 删除系统关键目录", "[기본 제공] 중요 시스템 디렉터리 삭제", "禁止删除系统关键路径", "중요 시스템 경로 삭제는 금지됩니다"},
		{"[内置] 磁盘格式化 mkfs", "[기본 제공] mkfs 디스크 포맷", "禁止格式化磁盘（mkfs）", "디스크 포맷(mkfs)은 금지됩니다"},
		{"[内置] 覆写磁盘设备 dd", "[기본 제공] dd 디스크 장치 덮어쓰기", "禁止使用 dd 覆写磁盘设备", "dd로 디스크 장치를 덮어쓰는 것은 금지됩니다"},
		{"[内置] Fork 炸弹", "[기본 제공] 포크 폭탄", "禁止执行 Fork 炸弹", "포크 폭탄은 금지됩니다"},
		{"[内置] 关机 / 重启", "[기본 제공] 종료/재부팅", "禁止执行关机或重启命令", "종료 및 재부팅 명령은 금지됩니다"},
		{"[内置] 杀死全部进程", "[기본 제공] 전체 프로세스 종료", "禁止 kill -9 -1 或 killall -9（杀死所有进程）", "kill -9 -1 및 killall -9는 모든 프로세스를 종료하므로 금지됩니다"},
		{"[内置] 磁盘擦除 shred / wipe", "[기본 제공] shred/wipe 디스크 삭제", "禁止对磁盘设备执行 shred/wipe 擦除", "shred/wipe로 디스크 장치를 지우는 것은 금지됩니다"},
		{"[内置] 清空防火墙规则", "[기본 제공] 방화벽 규칙 전체 삭제", "禁止清空防火墙规则（iptables -F / nft flush）", "방화벽 규칙 전체 삭제(iptables -F / nft flush)는 금지됩니다"},
		{"[内置] SQL DROP DATABASE / TABLE / SCHEMA", "[기본 제공] SQL DROP DATABASE/TABLE/SCHEMA", "禁止执行 DROP 操作，可能不可逆地销毁数据库对象", "DROP 작업은 데이터베이스 객체를 되돌릴 수 없게 삭제할 수 있어 금지됩니다"},
		{"[内置] SQL TRUNCATE", "[기본 제공] SQL TRUNCATE", "禁止执行 TRUNCATE，可能清空数据表所有数据", "TRUNCATE는 테이블의 모든 행을 삭제할 수 있어 금지됩니다"},
		{"[内置] MongoDB drop / dropDatabase", "[기본 제공] MongoDB drop/dropDatabase", "禁止执行 MongoDB drop 操作", "MongoDB drop 작업은 금지됩니다"},
		{"[内置] Redis FLUSHALL / FLUSHDB", "[기본 제공] Redis FLUSHALL/FLUSHDB", "禁止执行 Redis FLUSHALL / FLUSHDB，可能清空全部缓存数据", "Redis FLUSHALL/FLUSHDB는 캐시 데이터를 모두 지울 수 있어 금지됩니다"},
		{"[内置] curl / wget 发送 DELETE 请求", "[기본 제공] curl/wget DELETE 요청", "禁止通过 curl/wget 发送 HTTP DELETE 请求，可能删除目标系统数据", "curl/wget을 통한 HTTP DELETE 요청은 대상 시스템 데이터를 삭제할 수 있어 금지됩니다"},
		{"[内置] Python HTTP 客户端 DELETE（requests/httpx/aiohttp）", "[기본 제공] Python HTTP 클라이언트 DELETE", "禁止使用 Python HTTP 客户端发送 DELETE 请求", "Python HTTP 클라이언트의 DELETE 요청은 금지됩니다"},
		{"[内置] 脚本中声明 HTTP DELETE 方法（JS/通用）", "[기본 제공] 스크립트의 HTTP DELETE 메서드 선언", "禁止在脚本中声明并发送 HTTP DELETE 请求", "스크립트에서 HTTP DELETE를 선언하고 전송하는 것은 금지됩니다"},
		{"[内置] 批量清空 / 清除接口路径", "[기본 제공] 대량 삭제/정리 endpoint 경로", "禁止调用批量清空或销毁类接口（/clear /wipe /flush /purge 等）", "대량 삭제 또는 파괴적 endpoint 호출은 금지됩니다(/clear /wipe /flush /purge 등)"},
		{"[内置] 破坏性系统命令", "[기본 제공] 파괴적 시스템 명령", "破坏性命令被拒绝（rm -rf / / mkfs / dd / fork bomb / 关机重启 / 覆写磁盘设备）", "파괴적 명령이 거부되었습니다(rm -rf /, mkfs, dd, 포크 폭탄, 종료·재부팅, 디스크 장치 덮어쓰기)"},
		{"[内置] 数据外泄管道", "[기본 제공] 데이터 유출 파이프라인", "疑似数据外泄管道被拒绝（命令输出经 curl/wget/nc 外传）", "데이터 유출이 의심되는 파이프라인이 거부되었습니다(명령 출력을 curl/wget/nc로 전송)"},
		{"[Built-in] Recursive force deletion rm -rf", "[기본 제공] rm -rf 재귀 강제 삭제", "Recursive force deletion is forbidden (rm -rf / rm --recursive); it may permanently damage the system or target environment", "재귀 강제 삭제(rm -rf / rm --recursive)는 시스템 또는 대상 환경을 영구적으로 손상할 수 있어 금지됩니다"},
		{"[Built-in] Delete critical system directories", "[기본 제공] 중요 시스템 디렉터리 삭제", "Deleting critical system paths is forbidden", "중요 시스템 경로 삭제는 금지됩니다"},
		{"[Built-in] Disk formatting mkfs", "[기본 제공] mkfs 디스크 포맷", "Disk formatting (mkfs) is forbidden", "디스크 포맷(mkfs)은 금지됩니다"},
		{"[Built-in] Overwrite disk device with dd", "[기본 제공] dd 디스크 장치 덮어쓰기", "Using dd to overwrite disk devices is forbidden", "dd로 디스크 장치를 덮어쓰는 것은 금지됩니다"},
		{"[Built-in] Fork bomb", "[기본 제공] 포크 폭탄", "Fork bombs are forbidden", "포크 폭탄은 금지됩니다"},
		{"[Built-in] Shutdown / reboot", "[기본 제공] 종료/재부팅", "Shutdown and reboot commands are forbidden", "종료 및 재부팅 명령은 금지됩니다"},
		{"[Built-in] Kill all processes", "[기본 제공] 전체 프로세스 종료", "kill -9 -1 and killall -9 are forbidden (they kill all processes)", "kill -9 -1 및 killall -9는 모든 프로세스를 종료하므로 금지됩니다"},
		{"[Built-in] Disk erasure shred / wipe", "[기본 제공] shred/wipe 디스크 삭제", "Erasing disk devices with shred/wipe is forbidden", "shred/wipe로 디스크 장치를 지우는 것은 금지됩니다"},
		{"[Built-in] Flush firewall rules", "[기본 제공] 방화벽 규칙 전체 삭제", "Flushing firewall rules is forbidden (iptables -F / nft flush)", "방화벽 규칙 전체 삭제(iptables -F / nft flush)는 금지됩니다"},
		{"[Built-in] SQL DROP DATABASE / TABLE / SCHEMA", "[기본 제공] SQL DROP DATABASE/TABLE/SCHEMA", "DROP operations are forbidden; they may irreversibly destroy database objects", "DROP 작업은 데이터베이스 객체를 되돌릴 수 없게 삭제할 수 있어 금지됩니다"},
		{"[Built-in] SQL TRUNCATE", "[기본 제공] SQL TRUNCATE", "TRUNCATE is forbidden; it may remove all rows from a table", "TRUNCATE는 테이블의 모든 행을 삭제할 수 있어 금지됩니다"},
		{"[Built-in] MongoDB drop / dropDatabase", "[기본 제공] MongoDB drop/dropDatabase", "MongoDB drop operations are forbidden", "MongoDB drop 작업은 금지됩니다"},
		{"[Built-in] Redis FLUSHALL / FLUSHDB", "[기본 제공] Redis FLUSHALL/FLUSHDB", "Redis FLUSHALL / FLUSHDB is forbidden; it may clear all cached data", "Redis FLUSHALL/FLUSHDB는 캐시 데이터를 모두 지울 수 있어 금지됩니다"},
		{"[Built-in] Send DELETE requests with curl / wget", "[기본 제공] curl/wget DELETE 요청", "Sending HTTP DELETE requests through curl/wget is forbidden; it may delete target-system data", "curl/wget을 통한 HTTP DELETE 요청은 대상 시스템 데이터를 삭제할 수 있어 금지됩니다"},
		{"[Built-in] Python HTTP client DELETE (requests/httpx/aiohttp)", "[기본 제공] Python HTTP 클라이언트 DELETE", "Sending DELETE requests with a Python HTTP client is forbidden", "Python HTTP 클라이언트의 DELETE 요청은 금지됩니다"},
		{"[Built-in] Declare an HTTP DELETE method in a script (JS/generic)", "[기본 제공] 스크립트의 HTTP DELETE 메서드 선언", "Declaring and sending HTTP DELETE requests in scripts is forbidden", "스크립트에서 HTTP DELETE를 선언하고 전송하는 것은 금지됩니다"},
		{"[Built-in] Bulk clear / purge endpoint paths", "[기본 제공] 대량 삭제/정리 endpoint 경로", "Calling bulk-clear or destructive endpoints is forbidden (/clear /wipe /flush /purge, etc.)", "대량 삭제 또는 파괴적 endpoint 호출은 금지됩니다(/clear /wipe /flush /purge 등)"},
		{"[Built-in] Destructive system command", "[기본 제공] 파괴적 시스템 명령", "Destructive command rejected (rm -rf / / mkfs / dd / fork bomb / shutdown-reboot / disk-device overwrite)", "파괴적 명령이 거부되었습니다(rm -rf /, mkfs, dd, 포크 폭탄, 종료·재부팅, 디스크 장치 덮어쓰기)"},
		{"[Built-in] Data exfiltration pipeline", "[기본 제공] 데이터 유출 파이프라인", "Suspected data-exfiltration pipeline rejected (command output sent through curl/wget/nc)", "데이터 유출이 의심되는 파이프라인이 거부되었습니다(명령 출력을 curl/wget/nc로 전송)"},
		{"[内置] 删除类接口路径", "[기본 제공] 삭제 endpoint 경로", "禁止调用删除类接口（/delete /remove /unlink /erase 等），不论使用哪种 HTTP 方法——多数应用的删除接口用 GET/POST 就能触发，同样会真实删除目标数据", "HTTP 메서드와 관계없이 삭제 endpoint 호출은 금지됩니다(/delete /remove /unlink /erase 등). 많은 애플리케이션이 GET/POST로 삭제를 실행합니다"},
		{"[Built-in] Deletion endpoint path", "[기본 제공] 삭제 endpoint 경로", "Calling deletion endpoints is forbidden (/delete /remove /unlink /erase, etc.) regardless of HTTP method; many applications trigger deletion through GET/POST, which still deletes real target data", "HTTP 메서드와 관계없이 삭제 endpoint 호출은 금지됩니다(/delete /remove /unlink /erase 등). 많은 애플리케이션이 GET/POST로 삭제를 실행합니다"},
	}
	for _, p := range pairs {
		if _, err := d.Exec(`UPDATE intercept_rules SET name=$2, message=$4 WHERE name=$1 AND message=$3`, p.oldName, p.newName, p.oldMessage, p.newMessage); err != nil {
			return fmt.Errorf("migrate intercept rule text: %w", err)
		}
	}
	return nil
}

// seedDefaultInterceptRules inserts built-in safety intercept rules once on
// first startup. The seed is gated by a settings flag so user edits (disable,
// delete, re-order) are never overwritten on subsequent restarts.
func (d *DB) seedDefaultInterceptRules() error {
	if err := d.migrateLegacyInterceptText(); err != nil {
		return err
	}
	if v, _, _ := d.GetSetting("intercept_default_rules_v1"); v == "done" {
		return nil
	}
	type rule struct {
		name     string
		target   string // tool_name | tool_input
		typ      string // string | regex
		pattern  string
		action   string
		message  string
		priority int
	}
	rules := []rule{
		// ── 系统破坏性命令 (priority 100) ──────────────────────────────────
		{
			name:     "[기본 제공] rm -rf 재귀 강제 삭제",
			target:   "tool_input",
			typ:      "regex",
			pattern:  `(?i)\brm\b.{0,80}(?:-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*|--recursive|--no-preserve-root)`,
			action:   "deny",
			message:  "재귀 강제 삭제(rm -rf / rm --recursive)는 시스템 또는 대상 환경을 영구적으로 손상할 수 있어 금지됩니다",
			priority: 100,
		},
		{
			name:     "[기본 제공] 중요 시스템 디렉터리 삭제",
			target:   "tool_input",
			typ:      "regex",
			pattern:  `\brm\b[^"'\n]{0,60}["'\s](/|/etc|/bin|/usr|/boot|/var|/lib|/sys|/proc|/dev|/sbin|/root)`,
			action:   "deny",
			message:  "중요 시스템 경로 삭제는 금지됩니다",
			priority: 100,
		},
		{
			name:     "[기본 제공] mkfs 디스크 포맷",
			target:   "tool_input",
			typ:      "regex",
			pattern:  `\bmkfs\b`,
			action:   "deny",
			message:  "디스크 포맷(mkfs)은 금지됩니다",
			priority: 100,
		},
		{
			name:     "[기본 제공] dd 디스크 장치 덮어쓰기",
			target:   "tool_input",
			typ:      "regex",
			pattern:  `\bdd\b[^|\n]{0,100}\bof=\s*/dev/[a-zA-Z]`,
			action:   "deny",
			message:  "dd로 디스크 장치를 덮어쓰는 것은 금지됩니다",
			priority: 100,
		},
		{
			name:     "[기본 제공] 포크 폭탄",
			target:   "tool_input",
			typ:      "regex",
			pattern:  `:\(\)\s*\{[^}]*:\|:`,
			action:   "deny",
			message:  "포크 폭탄은 금지됩니다",
			priority: 100,
		},
		{
			name:     "[기본 제공] 종료/재부팅",
			target:   "tool_input",
			typ:      "regex",
			pattern:  `\b(?:shutdown|reboot|halt|poweroff|init\s+[06])\b`,
			action:   "deny",
			message:  "종료 및 재부팅 명령은 금지됩니다",
			priority: 100,
		},
		{
			name:     "[기본 제공] 전체 프로세스 종료",
			target:   "tool_input",
			typ:      "regex",
			pattern:  `\bkill\s+-9\s+-1\b|\bkillall\s+-9\b`,
			action:   "deny",
			message:  "kill -9 -1 및 killall -9는 모든 프로세스를 종료하므로 금지됩니다",
			priority: 100,
		},
		{
			name:     "[기본 제공] shred/wipe 디스크 삭제",
			target:   "tool_input",
			typ:      "regex",
			pattern:  `\b(?:shred|wipe)\b[^|\n]{0,80}/dev/[a-zA-Z]`,
			action:   "deny",
			message:  "shred/wipe로 디스크 장치를 지우는 것은 금지됩니다",
			priority: 100,
		},
		{
			name:     "[기본 제공] 방화벽 규칙 전체 삭제",
			target:   "tool_input",
			typ:      "regex",
			pattern:  `\biptables\s+(?:-F|--flush)\b|\bnft\s+flush\s+ruleset\b`,
			action:   "deny",
			message:  "방화벽 규칙 전체 삭제(iptables -F / nft flush)는 금지됩니다",
			priority: 100,
		},
		// ── 数据库破坏性操作 (priority 90) ─────────────────────────────────
		{
			name:     "[기본 제공] SQL DROP DATABASE/TABLE/SCHEMA",
			target:   "tool_input",
			typ:      "regex",
			pattern:  `(?i)\bDROP\s+(?:DATABASE|TABLE|SCHEMA|INDEX|VIEW|TABLESPACE|USER|ROLE)\b`,
			action:   "deny",
			message:  "DROP 작업은 데이터베이스 객체를 되돌릴 수 없게 삭제할 수 있어 금지됩니다",
			priority: 90,
		},
		{
			name:     "[기본 제공] SQL TRUNCATE",
			target:   "tool_input",
			typ:      "regex",
			pattern:  `(?i)\bTRUNCATE\s+(?:TABLE\s+)?\w`,
			action:   "deny",
			message:  "TRUNCATE는 테이블의 모든 행을 삭제할 수 있어 금지됩니다",
			priority: 90,
		},
		{
			name:     "[기본 제공] MongoDB drop/dropDatabase",
			target:   "tool_input",
			typ:      "regex",
			pattern:  `(?i)\.(?:dropDatabase|dropCollection|drop)\s*\(`,
			action:   "deny",
			message:  "MongoDB drop 작업은 금지됩니다",
			priority: 90,
		},
		{
			name:     "[기본 제공] Redis FLUSHALL/FLUSHDB",
			target:   "tool_input",
			typ:      "regex",
			pattern:  `(?i)\b(?:FLUSHALL|FLUSHDB)\b`,
			action:   "deny",
			message:  "Redis FLUSHALL/FLUSHDB는 캐시 데이터를 모두 지울 수 있어 금지됩니다",
			priority: 90,
		},
		// ── HTTP 破坏性请求 (priority 80) ──────────────────────────────────
		// Agent 发送 DELETE 请求的三种常见方式：
		//   1. curl -X DELETE / --request DELETE（Bash 工具直接执行或写入脚本）
		//   2. Python HTTP 客户端 .delete() 方法
		//   3. JS/通用脚本里的 method: 'DELETE' / method="DELETE"
		{
			name:     "[기본 제공] curl/wget DELETE 요청",
			target:   "tool_input",
			typ:      "regex",
			pattern:  `(?i)\bcurl\b[^|\n&;"]{0,300}(?:-X\s*DELETE|--request\s+DELETE|-XDELETE)|\bwget\b[^|\n&;"]{0,300}--method[=\s]+DELETE`,
			action:   "deny",
			message:  "curl/wget을 통한 HTTP DELETE 요청은 대상 시스템 데이터를 삭제할 수 있어 금지됩니다",
			priority: 80,
		},
		{
			name:     "[기본 제공] Python HTTP 클라이언트 DELETE",
			target:   "tool_input",
			typ:      "regex",
			pattern:  `(?i)\b(?:requests|httpx|aiohttp|urllib\.request)\.delete\s*\(|session\.delete\s*\(|client\.delete\s*\(`,
			action:   "deny",
			message:  "Python HTTP 클라이언트의 DELETE 요청은 금지됩니다",
			priority: 80,
		},
		{
			name:     "[기본 제공] 스크립트의 HTTP DELETE 메서드 선언",
			target:   "tool_input",
			typ:      "regex",
			pattern:  `(?i)axios\.delete\s*\(|method\s*[:=]\s*['"]DELETE['"]`,
			action:   "deny",
			message:  "스크립트에서 HTTP DELETE를 선언하고 전송하는 것은 금지됩니다",
			priority: 80,
		},
		{
			name:     "[기본 제공] 대량 삭제/정리 endpoint 경로",
			target:   "tool_input",
			typ:      "regex",
			pattern:  `(?i)/(?:clear|wipe|flush|purge|truncate|drop|destroy|factory[-_]reset|reset[-_]all)(?:[/?#"'\s]|$)`,
			action:   "deny",
			message:  "대량 삭제 또는 파괴적 endpoint 호출은 금지됩니다(/clear /wipe /flush /purge 등)",
			priority: 80,
		},
	}
	for _, r := range rules {
		if _, err := d.Exec(`
INSERT INTO intercept_rules(name, enabled, priority, match_target, match_type, pattern, action, message, timeout_enabled, timeout_seconds, timeout_action)
SELECT $1, true, $2, $3, $4, $5, $6, $7, false, 60, 'deny'
WHERE NOT EXISTS (
  SELECT 1 FROM intercept_rules WHERE match_target=$3 AND match_type=$4 AND pattern=$5
)`,
			r.name, r.priority, r.target, r.typ, r.pattern, r.action, r.message,
		); err != nil {
			return fmt.Errorf("rule %q: %w", r.name, err)
		}
	}
	return d.SetSetting("intercept_default_rules_v1", "done")
}

// seedDefaultInterceptRulesV2 migrates the two safety patterns that used to be
// hard-coded in guard.go (destructive shell + data-exfil pipe) into ordinary
// intercept rules. Gated by its own flag so it also lands on DBs that already ran
// v1. Unlike the old guard.go floor, these are plain [内置] rules — the user can
// disable or delete them. The exfil rule ships DISABLED by default (its
// curl/wget/nc pipe pattern mis-fires on legitimate CTF/pentest reverse-shell and
// data-transfer pipes); enable it manually when exfil gating is actually wanted.
func (d *DB) seedDefaultInterceptRulesV2() error {
	if err := d.migrateLegacyInterceptText(); err != nil {
		return err
	}
	if v, _, _ := d.GetSetting("intercept_default_rules_v2"); v == "done" {
		return nil
	}
	rules := []struct {
		name     string
		pattern  string
		action   string
		message  string
		enabled  bool
		priority int
	}{
		{
			name:     "[기본 제공] 파괴적 시스템 명령",
			pattern:  `(?i)\b(rm\s+-rf\s+/|mkfs|dd\s+if=|:\(\)\s*\{|shutdown|reboot|>\s*/dev/sd)`,
			action:   "deny",
			message:  "파괴적 명령이 거부되었습니다(rm -rf /, mkfs, dd, 포크 폭탄, 종료·재부팅, 디스크 장치 덮어쓰기)",
			enabled:  true,
			priority: 100,
		},
		{
			name:     "[기본 제공] 데이터 유출 파이프라인",
			pattern:  `(?i)(curl|wget|nc|ncat)\b[^|]*\b(\|\s*(curl|wget|nc))`,
			action:   "deny",
			message:  "데이터 유출이 의심되는 파이프라인이 거부되었습니다(명령 출력을 curl/wget/nc로 전송)",
			enabled:  false,
			priority: 80,
		},
	}
	for _, r := range rules {
		if _, err := d.Exec(`
INSERT INTO intercept_rules(name, enabled, priority, match_target, match_type, pattern, action, message, timeout_enabled, timeout_seconds, timeout_action)
SELECT $1, $2, $3, 'tool_input', 'regex', $4, $5, $6, false, 60, 'deny'
WHERE NOT EXISTS (
  SELECT 1 FROM intercept_rules WHERE match_target='tool_input' AND match_type='regex' AND pattern=$4
)`,
			r.name, r.enabled, r.priority, r.pattern, r.action, r.message,
		); err != nil {
			return fmt.Errorf("rule %q: %w", r.name, err)
		}
	}
	return d.SetSetting("intercept_default_rules_v2", "done")
}

// seedDefaultInterceptRulesV3 adds the delete-endpoint path rule. The v1 HTTP rules
// only catch the DELETE *method* (curl -X DELETE, requests.delete(, method:'DELETE'),
// and v1's path rule covers only /clear /wipe /flush /purge /truncate /drop /destroy
// /factory-reset /reset-all — so a plain `curl 'http://t/api/user/delete?id=1'` (a
// delete endpoint reached with GET/POST, which is how most web apps expose deletion)
// slipped through every built-in rule. Own flag so it also lands on DBs that already
// ran v1/v2, where editing the v1 seed would have no effect.
//
// The pattern deliberately requires a separator after the verb so /delivery,
// /details, /delta and /delegate do not match, while /deleteAll, /delete_user and
// /delete-user do. destroy is re-covered here because v1's rule does not allow a
// suffix (/destroyAll was missed).
//
// Exported as a package const only so the seeded regex is unit-testable without a DB.
const deleteEndpointPathPattern = `(?i)/(?:(?:delete|remove|unlink|erase|destroy)[-\w]*|del)(?:[/?#"'\s]|$)`

func (d *DB) seedDefaultInterceptRulesV3() error {
	if err := d.migrateLegacyInterceptText(); err != nil {
		return err
	}
	if v, _, _ := d.GetSetting("intercept_default_rules_v3"); v == "done" {
		return nil
	}
	const name = "[기본 제공] 삭제 endpoint 경로"
	if _, err := d.Exec(`
INSERT INTO intercept_rules(name, enabled, priority, match_target, match_type, pattern, action, message, timeout_enabled, timeout_seconds, timeout_action)
SELECT $1, true, 80, 'tool_input', 'regex', $2, 'deny', $3, false, 60, 'deny'
WHERE NOT EXISTS (
  SELECT 1 FROM intercept_rules WHERE match_target='tool_input' AND match_type='regex' AND pattern=$2
)`,
		name,
		deleteEndpointPathPattern,
		"HTTP 메서드와 관계없이 삭제 endpoint 호출은 금지됩니다(/delete /remove /unlink /erase 등). 많은 애플리케이션이 GET/POST로 삭제를 실행합니다",
	); err != nil {
		return fmt.Errorf("rule %q: %w", name, err)
	}
	return d.SetSetting("intercept_default_rules_v3", "done")
}
