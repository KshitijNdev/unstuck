#!/usr/bin/env bash
# One-time server setup. Run on the server as `team`: bash ~/unstuck/deploy/setup.sh
set -euo pipefail
sudo apt-get update
sudo apt-get install -y nginx git curl certbot python3-certbot-nginx
command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -; sudo apt-get install -y nodejs; }
command -v uv >/dev/null || [ -x ~/.local/bin/uv ] || curl -LsSf https://astral.sh/uv/install.sh | sh

cd ~/unstuck
sudo cp deploy/nginx-tryunstuck.us.conf /etc/nginx/sites-available/tryunstuck.us
sudo ln -sf /etc/nginx/sites-available/tryunstuck.us /etc/nginx/sites-enabled/tryunstuck.us
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo cp deploy/unstuck-api.service deploy/unstuck-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable unstuck-api unstuck-web

sudo certbot --nginx -d tryunstuck.us -d www.tryunstuck.us --redirect --agree-tos --register-unsafely-without-email -n
bash deploy/update.sh
