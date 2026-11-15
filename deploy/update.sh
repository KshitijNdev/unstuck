#!/usr/bin/env bash
# Pull latest main, rebuild, restart. Run on the server: bash ~/unstuck/deploy/update.sh
set -euo pipefail
cd ~/unstuck
git pull --ff-only
(cd services/api && ~/.local/bin/uv sync --frozen)
(cd apps/web && npm ci && NEXT_PUBLIC_API_URL=https://tryunstuck.us npm run build)
sudo systemctl restart unstuck-api unstuck-web
sleep 3
curl -fsS http://127.0.0.1:8000/health && echo " api ok"
curl -fsS -o /dev/null -w "web %{http_code}\n" http://127.0.0.1:3000/
