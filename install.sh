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
    ok "docker and docker compose detected"; return
  fi
  warn "docker / docker compose not found"
  case "$(uname -s)" in
    Linux)  die "Install and verify docker and compose using the official Docker repository instructions, then retry: https://docs.docker.com/engine/install/" ;;
    Darwin) die "Install Docker Desktop on macOS: https://www.docker.com/products/docker-desktop/" ;;
    *)      die "Install docker and retry" ;;
  esac
}

# ── ① 全部 Docker ───────────────────────────────
install_docker(){
  ensure_docker
  if [ ! -f .env ]; then
    local pw key
    pw="$(ask 'Postgres password (press Enter to generate one)' "$(rand)")"
    key="$(ask 'ANTHROPIC_API_KEY (optional; can be configured in the UI later)' '')"
    [[ "$pw" =~ ^[A-Za-z0-9._~-]+$ ]] || die "Docker Postgres passwords may contain only letters, digits, and . _ ~ - (avoids dotenv/DSN ambiguity)"
    [[ -z "$key" || "$key" =~ ^[A-Za-z0-9._-]+$ ]] || die "API keys may contain only letters, digits, and . _ -"
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
    ok ".env generated (POSTGRES_PASSWORD set)"
  else
    info "Using the existing .env"
  fi
  info "Pulling images and starting..."
  docker compose pull
  docker compose up -d
  ok "Started → http://localhost:8787"
  info "View logs: docker compose logs -f artex"
}

# ── ② 本地编译运行 ──────────────────────────────
install_local(){
  echo "Database setup:"
  echo "  1) Connect to an existing PostgreSQL"
  echo "  2) Start PostgreSQL with Docker (docker required)"
  case "$(ask 'Choose' 1)" in
    2)
      ensure_docker
      local pw; pw="$(ask 'Postgres password (press Enter to generate)' "$(rand)")"
      docker run -d --name artex-pg -p 5432:5432 \
        -e POSTGRES_USER=artex -e POSTGRES_PASSWORD="$pw" -e POSTGRES_DB=artex \
        -v artex-pg:/var/lib/postgresql/data \
        postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea
      DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=artex DB_PASS="$pw" DB_NAME=artex DB_SSL=disable ;;
    *)
      DB_HOST="$(ask 'Database host' 127.0.0.1)"
      DB_PORT="$(ask 'Port' 5432)"
      DB_USER="$(ask 'Username' artex)"
      DB_PASS="$(ask 'Password' '')"
      DB_NAME="$(ask 'Database name' artex)"
      DB_SSL="$(ask 'sslmode (disable/require)' disable)" ;;
  esac

  # 生成 config.json
  [[ "$DB_PORT" =~ ^[0-9]+$ ]] || die "Database port must be an integer from 1 to 65535"
  local port_num=$((10#$DB_PORT))
  (( port_num >= 1 && port_num <= 65535 )) || die "Database port must be an integer from 1 to 65535"
  case "$DB_SSL" in disable|require|verify-ca|verify-full) ;; *) die "sslmode must be disable, require, verify-ca, or verify-full" ;; esac
  local value
  for value in "$DB_HOST" "$DB_USER" "$DB_PASS" "$DB_NAME" "$DB_SSL"; do
    [[ ! "$value" =~ [[:cntrl:]] ]] || die "Database configuration must not contain control characters"
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
  ok "config.json generated"

  # go 环境检查
  command -v go >/dev/null 2>&1 || die "Go was not found; install Go (>=1.26): https://go.dev/dl/"
  ok "Go: $(go version)"

  # 内嵌前端需要 node 出静态产物
  if command -v npm >/dev/null 2>&1; then
    info "Building static frontend assets..."
    ( cd web && npm ci && npm run build:static )
    rm -rf server/webui/dist && cp -r web/out server/webui/dist
    info "Building the self-contained binary..."
    CGO_ENABLED=0 go build -tags embedui -trimpath -o artex ./cmd/artex
  else
    warn "npm was not found; building the backend without an embedded frontend (run npm run dev separately)"
    CGO_ENABLED=0 go build -o artex ./cmd/artex
  fi
  ok "Build complete → ./artex"

  info "Starting... (Ctrl-C to exit)"
  ./artex
}

echo "=============================="
echo "  ARTEX installation"
echo "  1) Full Docker installation"
echo "  2) Local run (compile with Go)"
echo "=============================="
case "$(ask 'Choose' 1)" in
  1) install_docker ;;
  2) install_local ;;
  *) die "Invalid choice" ;;
esac
