#!/usr/bin/env bash
# ARTEX 安装脚本：① 全部 Docker  ② 本地编译运行
set -euo pipefail
umask 077
cd "$(cd "$(dirname "$0")" && pwd)"

info(){ printf '\033[36m[*]\033[0m %s\n' "$*"; }
ok(){   printf '\033[32m[+]\033[0m %s\n' "$*"; }
warn(){ printf '\033[33m[!]\033[0m %s\n' "$*"; }
die(){  printf '\033[31m[x]\033[0m %s\n' "$*" >&2; exit 1; }
ask(){  local p="$1" d="${2:-}" a; read -rp "$p${d:+ [$d]}: " a; echo "${a:-$d}"; }
rand(){ head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24; }
json_escape(){
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

# ── docker 环境检测 ──────────────────────────────
ensure_docker(){
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    ok "已检测到 docker 与 docker compose"; return
  fi
  warn "未检测到 docker / docker compose"
  case "$(uname -s)" in
    Linux)  die "请按 Docker 官方仓库说明安装并验证 docker 与 compose 后重试：https://docs.docker.com/engine/install/" ;;
    Darwin) die "macOS 请安装 Docker Desktop：https://www.docker.com/products/docker-desktop/" ;;
    *)      die "请自行安装 docker 后重试" ;;
  esac
}

# ── ① 全部 Docker ───────────────────────────────
install_docker(){
  ensure_docker
  if [ ! -f .env ]; then
    local pw key
    pw="$(ask 'Postgres 密码（回车随机生成）' "$(rand)")"
    key="$(ask 'ANTHROPIC_API_KEY（可留空，后续在 UI 配）' '')"
    [[ "$pw" =~ ^[A-Za-z0-9._~-]+$ ]] || die "Docker 模式的 Postgres 密码仅允许字母、数字及 . _ ~ -（避免 dotenv/DSN 歧义）"
    [[ -z "$key" || "$key" =~ ^[A-Za-z0-9._-]+$ ]] || die "API Key 仅允许字母、数字及 . _ -"
    cat > .env <<ENV
# Docker 部署配置（由 install.sh 生成）
ARTEX_TAG=v0.3.15
ARTEX_BIND_ADDR=127.0.0.1
POSTGRES_USER=artex
POSTGRES_PASSWORD=${pw}
POSTGRES_DB=artex
ANTHROPIC_API_KEY=${key}
OPENAI_API_KEY=
ARTEX_LLM_PROVIDER=
ARTEX_LLM_MODEL=
ARTEX_LLM_BASE_URL=
ARTEX_LLM_PROXY=
ENV
    ok "已生成 .env（POSTGRES_PASSWORD 已设置）"
  else
    info "沿用已存在的 .env"
  fi
  info "拉取镜像并启动…"
  docker compose pull
  docker compose up -d
  ok "启动完成 → http://localhost:8787"
  info "查看日志：docker compose logs -f artex"
}

# ── ② 本地编译运行 ──────────────────────────────
install_local(){
  echo "数据库安装方式："
  echo "  1) 连接已有 PostgreSQL"
  echo "  2) 用 Docker 起一个 PostgreSQL（需要 docker）"
  case "$(ask '选择' 1)" in
    2)
      ensure_docker
      local pw; pw="$(ask 'Postgres 密码（回车随机）' "$(rand)")"
      docker run -d --name artex-pg -p 5432:5432 \
        -e POSTGRES_USER=artex -e POSTGRES_PASSWORD="$pw" -e POSTGRES_DB=artex \
        -v artex-pg:/var/lib/postgresql/data \
        postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea
      DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=artex DB_PASS="$pw" DB_NAME=artex DB_SSL=disable ;;
    *)
      DB_HOST="$(ask '数据库地址' 127.0.0.1)"
      DB_PORT="$(ask '端口' 5432)"
      DB_USER="$(ask '账号' artex)"
      DB_PASS="$(ask '密码' '')"
      DB_NAME="$(ask '数据库名' artex)"
      DB_SSL="$(ask 'sslmode (disable/require)' disable)" ;;
  esac

  # 生成 config.json
  [[ "$DB_PORT" =~ ^[0-9]+$ ]] || die "数据库端口必须是 1-65535 的整数"
  local port_num=$((10#$DB_PORT))
  (( port_num >= 1 && port_num <= 65535 )) || die "数据库端口必须是 1-65535 的整数"
  case "$DB_SSL" in disable|require|verify-ca|verify-full) ;; *) die "sslmode 必须是 disable、require、verify-ca 或 verify-full" ;; esac
  local value
  for value in "$DB_HOST" "$DB_USER" "$DB_PASS" "$DB_NAME" "$DB_SSL"; do
    [[ ! "$value" =~ [[:cntrl:]] ]] || die "数据库配置不能包含控制字符"
  done
  local host_json user_json pass_json name_json ssl_json
  host_json="$(json_escape "$DB_HOST")"
  user_json="$(json_escape "$DB_USER")"
  pass_json="$(json_escape "$DB_PASS")"
  name_json="$(json_escape "$DB_NAME")"
  ssl_json="$(json_escape "$DB_SSL")"
  cat > config.json <<JSON
{
  "database": {
    "host": "${host_json}",
    "port": ${port_num},
    "user": "${user_json}",
    "password": "${pass_json}",
    "dbname": "${name_json}",
    "sslmode": "${ssl_json}"
  }
}
JSON
  ok "已生成 config.json"

  # go 环境检查
  command -v go >/dev/null 2>&1 || die "未检测到 Go，请先安装 Go（>=1.26）：https://go.dev/dl/"
  ok "Go: $(go version)"

  # 内嵌前端需要 node 出静态产物
  if command -v npm >/dev/null 2>&1; then
    info "构建前端静态产物…"
    ( cd web && npm ci && npm run build:static )
    rm -rf server/webui/dist && cp -r web/out server/webui/dist
    info "编译内嵌单二进制…"
    CGO_ENABLED=0 go build -tags embedui -trimpath -o artex ./cmd/artex
  else
    warn "未检测到 npm：将编译**不内嵌前端**的后端（前端需另跑 npm run dev）"
    CGO_ENABLED=0 go build -o artex ./cmd/artex
  fi
  ok "编译完成 → ./artex"

  info "启动…（Ctrl-C 退出）"
  ./artex
}

echo "=============================="
echo "  ARTEX 安装"
echo "  1) 全部 Docker 安装"
echo "  2) 本地运行（go 编译）"
echo "=============================="
case "$(ask '选择' 1)" in
  1) install_docker ;;
  2) install_local ;;
  *) die "无效选择" ;;
esac
