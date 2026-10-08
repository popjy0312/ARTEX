#!/bin/sh
# ARTEX supervisor startup script (Linux / macOS / Docker ENTRYPOINT)
#
# Usage:
#   ./start.sh                       run in the foreground (Ctrl-C to stop)
#   nohup ./start.sh >artex.log 2>&1 &   run persistently in the background
#   ./start.sh -addr :9000           pass extra arguments through to artex
#
# It runs artex and decides whether to restart it based on the exit code.
#
#   0      normal user stop     -> exit the loop
#   other  crash                -> restart with backoff (1->2->4... up to 60s)
#
set -u

cd "$(dirname "$0")" || exit 1

BIN=./artex
[ -x "$BIN" ] || { echo "[artex] executable not found: $BIN" >&2; exit 1; }

MAX_DELAY=60

child=0
stopping=0

# Forward stop signals to the artex process.
#
# This is required in Docker: docker stop sends SIGTERM only to PID 1 (this script),
# not to child processes. Without forwarding it, artex cannot shut down gracefully
# and is force-killed after 10 seconds, interrupting active tasks.
forward() {
	stopping=1
	if [ "$child" -ne 0 ]; then
		kill -TERM "$child" 2>/dev/null || true
	fi
}
trap forward INT TERM

delay=1
while :; do
	"$BIN" "$@" &
	child=$!

	# A signal interrupts wait and makes it return >128. The child may still be
	# shutting down gracefully, so wait once more to obtain its actual exit code.
	wait "$child"
	code=$?
	if [ "$code" -gt 128 ]; then
		wait "$child"
		code=$?
	fi
	child=0

	if [ "$stopping" -eq 1 ]; then
		echo "[artex] stopped"
		exit 0
	fi

	case "$code" in
		0)
			echo "[artex] exited normally"
			exit 0
			;;
		*)
			echo "[artex] exited unexpectedly (code=$code); restarting in ${delay}s" >&2
			sleep "$delay"
			delay=$((delay * 2))
			[ "$delay" -gt "$MAX_DELAY" ] && delay=$MAX_DELAY
			;;
	esac
done
