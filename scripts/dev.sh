#!/usr/bin/env bash
# Local dev control for Unstuck. Usage: scripts/dev.sh {start|stop|restart|status|logs}
# API -> http://127.0.0.1:8000 (log: .logs/api.log), Web -> http://localhost:3000 (log: .logs/web.log)
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/bin:$HOME/.local/node22/bin:$PATH"
LOGS="$ROOT/.logs"; mkdir -p "$LOGS"

stop() {
  pkill -f "uvicorn app.main:app" 2>/dev/null
  pkill -f "next dev" 2>/dev/null
  pkill -f "next-server" 2>/dev/null
  for port in 8000 3000; do
    pids=$(ss -ltnp 2>/dev/null | grep ":$port\b" | grep -o 'pid=[0-9]*' | cut -d= -f2)
    [ -n "$pids" ] && kill $pids 2>/dev/null
  done
  sleep 1
  echo "stopped"
}

start() {
  (cd "$ROOT/services/api" && nohup uv run uvicorn app.main:app --port 8000 --reload --reload-dir app \
      > "$LOGS/api.log" 2>&1 &)
  # Pin the browser to this API port so a changed default in apps/web/lib/api.ts can't point it elsewhere.
  (cd "$ROOT/apps/web" && NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 nohup npm run dev > "$LOGS/web.log" 2>&1 &)
  for i in $(seq 1 40); do
    a=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/health || true)
    w=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 || true)
    [ "$a" != "000" ] && [ "$w" != "000" ] && break
    sleep 1
  done
  status
}

status() {
  echo "api: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/health)  (log $LOGS/api.log)"
  echo "web: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000)  (log $LOGS/web.log)"
}

case "${1:-restart}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  logs) tail -n 40 "$LOGS/api.log"; echo "-----"; tail -n 40 "$LOGS/web.log" ;;
  *) echo "usage: $0 {start|stop|restart|status|logs}"; exit 1 ;;
esac
