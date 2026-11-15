#!/usr/bin/env bash
# Redeploy latest main to tryunstuck.us. From your laptop:
#   ssh root@209.222.2.137 'bash /opt/unstuck/deploy/update.sh'
# Server layout: code /opt/unstuck (git checkout), data + sqlite /opt/unstuck-data,
# secrets /opt/unstuck/services/api/.env (not in git), Caddy /etc/caddy/Caddyfile (auto SSL).
set -euo pipefail
cd /opt/unstuck
git pull --ff-only
(cd services/api && /root/.local/bin/uv sync --frozen -q)
(cd apps/web && npm ci --silent && NEXT_PUBLIC_API_URL=https://tryunstuck.us npm run build)
systemctl restart unstuck-api unstuck-web
sleep 10
curl -fsS http://127.0.0.1:8000/health && echo " api ok"
curl -fsS -o /dev/null -w "web %{http_code}\n" http://127.0.0.1:3000/
