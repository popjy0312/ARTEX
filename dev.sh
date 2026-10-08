#!/usr/bin/env bash
# Development mode: backend (:8787), traffic proxy (:8788), and frontend dev
# server (:5173) run together. The frontend proxies /api to the backend;
# Ctrl-C stops all of them.
#
# For the single-binary (embedded frontend) mode, see the corresponding README
# section; this script is not used for that mode.
set -euo pipefail
cd "$(dirname "$0")"

# Stop all child processes in this process group on exit (backend + frontend).
cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# Backend (regular go run without the embedded frontend); configure the number
# of concurrent work agents in System Settings.
go run ./cmd/artex -addr :8787 -proxy 127.0.0.1:8788 &

# Frontend hot reload (Vite/Next dev server; /api proxies to :8787).
( cd web && npm run dev ) &

echo "[dev] backend :8787 / proxy :8788 / frontend http://localhost:5173  (Ctrl-C to exit)"
wait
