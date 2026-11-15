#!/usr/bin/env bash
# Run LOCALLY. Copies the gitignored CoStar data and .env to the server (never via git).
set -euo pipefail
HOST=team@209.222.2.137
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
rsync -az --info=progress2 "$ROOT/data/" "$HOST:unstuck/data/"
sed -e 's#^COSTAR_KIT_DIR=.*#COSTAR_KIT_DIR=/home/team/unstuck/data/costar#' \
    -e '/^WEB_ORIGINS=/d' "$ROOT/services/api/.env" > /tmp/unstuck.env.$$
echo 'WEB_ORIGINS=https://tryunstuck.us,https://www.tryunstuck.us' >> /tmp/unstuck.env.$$
scp -q /tmp/unstuck.env.$$ "$HOST:unstuck/services/api/.env"
rm -f /tmp/unstuck.env.$$
ssh "$HOST" 'chmod 600 ~/unstuck/services/api/.env'
echo "data + .env uploaded"
