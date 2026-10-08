#!/usr/bin/env bash
# =============================================================================
# ARTEX administrator password reset script
#
# The login username is fixed as ARTEX. The password is stored as a bcrypt hash
# in the auth.password_hash key of the settings table. This script connects to
# the database, generates the hash with pgcrypto, and writes it back; it is fully
# compatible with the backend login check (golang.org/x/crypto/bcrypt).
#
# Two deployment modes:
#   local (default) -- use psql directly from the host. Connection information
#                      priority: command-line args > --dsn/$ARTEX_PG_DSN > config.json database.*
#   docker         -- run psql inside the postgres container with `docker compose exec`
#                    (or `docker exec`; compose does not expose port 5432 by default).
#
# Examples:
#   ./reset-password.sh                          # local; read config.json/env and prompt for password
#   ./reset-password.sh -p 'NewPass!'            # local; provide the new password directly
#   ./reset-password.sh --dsn postgres://u:p@h:5432/artex
#   ./reset-password.sh -H 127.0.0.1 -P 5433 -U autopentest -W pass -d artex
#   ./reset-password.sh -m docker                # Docker deployment (read POSTGRES_* from .env)
#   ./reset-password.sh -m docker -c pg-container --exec docker
#
# Security: pass the new password through an environment variable and psql
# \getenv (not process argv), using :'var' for automatic escaping (SQL injection
# protection). Pass the database password through PGPASSWORD, also outside argv.
# =============================================================================
set -euo pipefail

PASS_KEY="auth.password_hash"
BCRYPT_COST=10

MODE=""            # local | docker (empty = auto-detect)
DSN=""
HOST="" PORT="" USER="" DBPASS="" DBNAME="" SSLMODE=""
CONFIG=""
CONTAINER=""       # postgres service/container name in Docker mode (default: postgres)
EXEC_KIND=""       # compose | docker (exec method; empty = auto-detect)
NEWPASS=""
ASSUME_YES=0

die() { echo "Error: $*" >&2; exit 1; }
info() { echo "· $*" >&2; }

usage() { sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

# ---- Argument parsing ------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--mode)        MODE="${2:-}"; shift 2 ;;
    --dsn)            DSN="${2:-}"; shift 2 ;;
    -H|--host)        HOST="${2:-}"; shift 2 ;;
    -P|--port)        PORT="${2:-}"; shift 2 ;;
    -U|--user)        USER="${2:-}"; shift 2 ;;
    -W|--db-password) DBPASS="${2:-}"; shift 2 ;;
    -d|--dbname)      DBNAME="${2:-}"; shift 2 ;;
    --sslmode)        SSLMODE="${2:-}"; shift 2 ;;
    --config)         CONFIG="${2:-}"; shift 2 ;;
    -c|--container)   CONTAINER="${2:-}"; shift 2 ;;
    --exec)           EXEC_KIND="${2:-}"; shift 2 ;;
    -p|--new-password) NEWPASS="${2:-}"; shift 2 ;;
    -y|--yes)         ASSUME_YES=1; shift ;;
    -h|--help)        usage ;;
    *) die "Unknown option: $1 (use -h for help)" ;;
  esac
done

# ---- Read database.* from config.json (local mode without explicit connection) ----
# Prefer python3 for robust parsing; fall back to grep when python3 is unavailable.
read_config_json() {
  local path="$1"
  [[ -f "$path" ]] || return 1
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$path" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1])).get("database", {})
except Exception:
    sys.exit(1)
# Support either a complete DSN or separate fields.
if d.get("dsn"):
    print("DSN\t" + d["dsn"]); sys.exit(0)
for k in ("host","port","user","password","dbname","sslmode"):
    if d.get(k) is not None:
        print(k.upper() + "\t" + str(d[k]))
PY
  else
    # Minimal fallback: grep each key (values are strings or numbers).
    local k
    for k in host port user password dbname sslmode; do
      local v
      v=$(grep -oE "\"$k\"[[:space:]]*:[[:space:]]*(\"[^\"]*\"|[0-9]+)" "$path" 2>/dev/null \
            | head -1 | sed -E "s/.*:[[:space:]]*//; s/^\"//; s/\"$//") || true
      [[ -n "$v" ]] && echo -e "${k^^}\t$v"
    done
  fi
}

apply_config_fields() {
  local line key val
  while IFS=$'\t' read -r key val; do
    [[ -z "$key" ]] && continue
    case "$key" in
      DSN)      [[ -z "$DSN" ]] && DSN="$val" ;;
      HOST)     [[ -z "$HOST" ]] && HOST="$val" ;;
      PORT)     [[ -z "$PORT" ]] && PORT="$val" ;;
      USER)     [[ -z "$USER" ]] && USER="$val" ;;
      PASSWORD) [[ -z "$DBPASS" ]] && DBPASS="$val" ;;
      DBNAME)   [[ -z "$DBNAME" ]] && DBNAME="$val" ;;
      SSLMODE)  [[ -z "$SSLMODE" ]] && SSLMODE="$val" ;;
    esac
  done
}

# ---- Auto-detect deployment mode ------------------------------------------
if [[ -z "$MODE" ]]; then
  if [[ -n "$DSN$HOST$USER$DBNAME" || -n "${ARTEX_PG_DSN:-}" || -f "${CONFIG:-config.json}" ]]; then
    MODE="local"
  elif command -v docker >/dev/null 2>&1 && [[ -f docker-compose.yml ]]; then
    MODE="docker"
  else
    MODE="local"
  fi
fi
info "Deployment mode: $MODE"

# ---- Collect the new password ---------------------------------------------
if [[ -z "$NEWPASS" ]]; then
  read -r -s -p "Enter the new password (username is fixed as ARTEX): " NEWPASS; echo >&2
  [[ -n "$NEWPASS" ]] || die "Password must not be empty"
  read -r -s -p "Enter it again to confirm: " NEWPASS2; echo >&2
  [[ "$NEWPASS" == "$NEWPASS2" ]] || die "Passwords do not match"
fi
[[ -n "$NEWPASS" ]] || die "Password must not be empty"

# Pass the password to psql through an environment variable (read by \getenv,
# never exposed in argv or ps output).
export ARTEX_RESET_NEWPASS="$NEWPASS"

# Generate and upsert the bcrypt hash in the database; :'newpw' escapes the
# password automatically. CREATE EXTENSION is idempotent; lack of permission
# to create extensions is reported by the failure branch below.
SQL=$(cat <<SQL
\\set ON_ERROR_STOP on
\\getenv newpw ARTEX_RESET_NEWPASS
CREATE EXTENSION IF NOT EXISTS pgcrypto;
INSERT INTO settings(key, value)
VALUES ('$PASS_KEY', crypt(:'newpw', gen_salt('bf', $BCRYPT_COST)))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
SQL
)

# ---- Execute ---------------------------------------------------------------
if [[ "$MODE" == "local" ]]; then
  # Connection priority: command line > --dsn/$ARTEX_PG_DSN > config.json
  if [[ -z "$DSN" && -z "$HOST$USER$DBNAME" ]]; then
    [[ -n "${ARTEX_PG_DSN:-}" ]] && DSN="$ARTEX_PG_DSN"
  fi
  if [[ -z "$DSN" && -z "$HOST$USER$DBNAME" ]]; then
    cfg="${CONFIG:-config.json}"
    if [[ -f "$cfg" ]]; then
      info "Reading database configuration from $cfg"
      apply_config_fields < <(read_config_json "$cfg")
    fi
  fi

    command -v psql >/dev/null 2>&1 || die "psql was not found (install postgresql-client or use -m docker)"

  declare -a PSQL_ARGS=()
  if [[ -n "$DSN" ]]; then
    PSQL_ARGS=("$DSN")
    target="$DSN"
  else
    [[ -n "$USER"   ]] || die "Database user is missing (-U or a valid config.json/DSN)"
    [[ -n "$DBNAME" ]] || die "Database name is missing (-d or a valid config.json/DSN)"
    HOST="${HOST:-127.0.0.1}"; PORT="${PORT:-5432}"; SSLMODE="${SSLMODE:-disable}"
    PSQL_ARGS=(-h "$HOST" -p "$PORT" -U "$USER" -d "$DBNAME")
    [[ -n "$SSLMODE" ]] && export PGSSLMODE="$SSLMODE"
    [[ -n "$DBPASS" ]] && export PGPASSWORD="$DBPASS"
    target="$USER@$HOST:$PORT/$DBNAME"
  fi

  info "Target database: $target"
  if [[ "$ASSUME_YES" -ne 1 ]]; then
    read -r -p "Reset the ARTEX password in this database? [y/N] " ans
    [[ "$ans" == "y" || "$ans" == "Y" ]] || die "Cancelled"
  fi

  if ! printf '%s\n' "$SQL" | psql "${PSQL_ARGS[@]}" -v ON_ERROR_STOP=1 -q >/dev/null; then
    die "Write failed. If pgcrypto is missing or permission is denied, use a role that can create extensions or run CREATE EXTENSION pgcrypto first."
  fi

else
  # ---- Docker ----
  command -v docker >/dev/null 2>&1 || die "docker was not found"
  CONTAINER="${CONTAINER:-postgres}"

  # Select the exec method: prefer docker compose exec (service name), then docker exec (container name).
  if [[ -z "$EXEC_KIND" ]]; then
    if docker compose version >/dev/null 2>&1 && [[ -f docker-compose.yml ]]; then
      EXEC_KIND="compose"
    else
      EXEC_KIND="docker"
    fi
  fi

  # Container psql credentials: command line, then .env POSTGRES_*, then compose default (artex).
  if [[ -f .env ]]; then
    # shellcheck disable=SC1091
    set -a; . ./.env; set +a
  fi
  DUSER="${USER:-${POSTGRES_USER:-artex}}"
  DNAME="${DBNAME:-${POSTGRES_DB:-artex}}"
  [[ -n "$DBPASS" ]] && export PGPASSWORD="$DBPASS"
  [[ -z "${PGPASSWORD:-}" && -n "${POSTGRES_PASSWORD:-}" ]] && export PGPASSWORD="$POSTGRES_PASSWORD"

  info "Target: psql -U $DUSER -d $DNAME in container $CONTAINER (exec=$EXEC_KIND)"
  if [[ "$ASSUME_YES" -ne 1 ]]; then
    read -r -p "Reset the ARTEX password in this container database? [y/N] " ans
    [[ "$ans" == "y" || "$ans" == "Y" ]] || die "Cancelled"
  fi

  # -e passes only variable names so values are inherited from the environment;
  # passwords do not appear in the docker command argv.
  declare -a EXEC_CMD
  if [[ "$EXEC_KIND" == "compose" ]]; then
    EXEC_CMD=(docker compose exec -T -e ARTEX_RESET_NEWPASS -e PGPASSWORD "$CONTAINER"
              psql -U "$DUSER" -d "$DNAME" -v ON_ERROR_STOP=1 -q)
  else
    EXEC_CMD=(docker exec -i -e ARTEX_RESET_NEWPASS -e PGPASSWORD "$CONTAINER"
              psql -U "$DUSER" -d "$DNAME" -v ON_ERROR_STOP=1 -q)
  fi

  if ! printf '%s\n' "$SQL" | "${EXEC_CMD[@]}" >/dev/null; then
    die "Write failed. Check the container name (-c), database credentials (.env POSTGRES_*), and pgcrypto permissions."
  fi
fi

unset ARTEX_RESET_NEWPASS
echo "✓ ARTEX administrator password reset. Log in with username ARTEX and the new password (no restart required)."
