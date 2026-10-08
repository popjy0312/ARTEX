#!/usr/bin/env bash
# ARTEX update script: 1) Docker update (pull and recreate)  2) local rebuild.
# This complements install.sh: install performs the initial deployment, update upgrades it.
# No manual DB migration is required: artex idempotently reapplies schema.sql on startup
# (including ADD COLUMN/CREATE INDEX IF NOT EXISTS), so restarting performs the migration.
# Data (the pgdata volume, ./data, ./state, and ./skills) is preserved.
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"

info(){ printf '\033[36m[*]\033[0m %s\n' "$*"; }
ok(){   printf '\033[32m[+]\033[0m %s\n' "$*"; }
warn(){ printf '\033[33m[!]\033[0m %s\n' "$*"; }
die(){  printf '\033[31m[x]\033[0m %s\n' "$*" >&2; exit 1; }
ask(){  local p="$1" d="${2:-}" a; read -rp "$p${d:+ [$d]}: " a; echo "${a:-$d}"; }

# ── Optional: sync the repository to the latest code ─────────────────────────
sync_repo(){
  [ -d .git ] && command -v git >/dev/null 2>&1 || { warn "Not a git working copy; skipping git pull"; return; }
  [ "$(ask 'Pull the latest code (git pull --ff-only)? (y/n)' y)" = y ] || return
  if ! git pull --ff-only; then
    warn "git pull could not fast-forward (local changes or diverged branch); resolve it manually and retry; using the current code"
  fi
}

# ── 1) Docker update ────────────────────────────
update_docker(){
  command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 \
    || die "docker / docker compose not found; run ./install.sh first"
  [ -f .env ] || die ".env not found; run ./install.sh for the initial deployment"

  # Optional: upgrade to a specific version tag (otherwise keep .env's ARTEX_TAG,
  # defaulting to v0.3.15).
  local tag; tag="$(ask 'Target image tag (press Enter to keep .env / v0.3.15)' '')"
  if [ -n "$tag" ]; then
    if grep -q '^ARTEX_TAG=' .env; then
      sed -i.bak "s|^ARTEX_TAG=.*|ARTEX_TAG=${tag}|" .env && rm -f .env.bak
    else
      printf '\nARTEX_TAG=%s\n' "$tag" >> .env
    fi
    ok "ARTEX_TAG set to ${tag}"
  fi

  # Update artex only: postgres is pinned to 16-alpine and does not need to be
  # upgraded with it. Updating it would waste bandwidth and risk compatibility.
  # artex declares depends_on postgres, so bringing up the service starts postgres
  # when needed while leaving an already-running instance unchanged.
  info "Pulling the new image (artex only)..."
  docker compose pull artex
  info "Recreating and starting (artex migrates the schema on restart)..."
  docker compose up -d artex
  ok "Update complete → http://localhost:8787"
  info "View logs: docker compose logs -f artex"
  info "Clean up old images (optional): docker image prune -f"
}

# ── 2) Local build update ───────────────────────
update_local(){
  command -v go >/dev/null 2>&1 || die "Go (>=1.26) was not found: https://go.dev/dl/"
  [ -f config.json ] || warn "config.json not found; use ./install.sh for the initial deployment"
  ok "Go: $(go version)"

  if command -v npm >/dev/null 2>&1; then
    info "Rebuilding static frontend assets..."
    ( cd web && npm ci && npm run build:static )
    rm -rf server/webui/dist && cp -r web/out server/webui/dist
    info "Rebuilding the self-contained binary..."
    CGO_ENABLED=0 go build -tags embedui -trimpath -o artex ./cmd/artex
  else
    warn "npm was not found; building the backend without an embedded frontend (run npm run dev separately)"
    CGO_ENABLED=0 go build -o artex ./cmd/artex
  fi
  ok "Build complete → ./artex"
  warn "Restart the running artex process to apply the update (the schema migrates on restart)"
}

echo "=============================="
echo "  ARTEX update"
echo "  1) Docker update (pull and recreate image)"
echo "  2) Local update (recompile with Go)"
echo "=============================="
case "$(ask 'Choose' 1)" in
  1) sync_repo; update_docker ;;
  2) sync_repo; update_local ;;
  *) die "Invalid choice" ;;
esac
