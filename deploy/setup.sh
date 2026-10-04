#!/usr/bin/env bash
# One-shot bootstrap for a fresh Oracle Cloud "Always Free" Ubuntu VM.
# Run as the normal (non-root) user you SSH in as, from anywhere: bash setup.sh
# Idempotent-ish: safe to re-run after a `git pull` to pick up code changes.
set -euo pipefail

REPO_URL="https://github.com/ameyg23/VoiceNexus.git"
APP_DIR="$HOME/voice-nexus"

echo "== Installing Node 24, git, nginx, certbot, pm2 =="
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git nginx certbot python3-certbot-nginx
sudo npm install -g pm2

if [ ! -d "$APP_DIR" ]; then
  echo "== Cloning $REPO_URL =="
  git clone "$REPO_URL" "$APP_DIR"
else
  echo "== $APP_DIR already exists, pulling latest =="
  git -C "$APP_DIR" pull
fi

cd "$APP_DIR"

if [ ! -f .env ]; then
  echo "== No .env found — copying .env.example. EDIT IT NOW with real secrets before continuing: =="
  cp .env.example .env
  echo "    nano $APP_DIR/.env"
  echo "Then re-run this script, or just continue manually from 'npm install' below."
  exit 0
fi

echo "== Installing dependencies =="
npm install

echo "== Running DB migrations =="
npm run db:migrate

if [ ! -f packages/db/data/voice-nexus.sqlite ] || [ "$(stat -c%s packages/db/data/voice-nexus.sqlite 2>/dev/null || echo 0)" -lt 10000 ]; then
  echo "== Seeding demo data (first run only) =="
  npm run db:seed
fi

echo "== Building the web app =="
npm run build --workspace=apps/web

echo "== Starting both apps under pm2 =="
pm2 start deploy/ecosystem.config.cjs
pm2 save
echo "Run the printed 'pm2 startup ...' command once (with sudo) so both apps survive a VM reboot:"
pm2 startup || true

cat <<'EOF'

== Next steps (manual, one-time) ==
1. Point nginx + get a free HTTPS cert:
   sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/voice-nexus
   # edit server_name to your-vm-ip.nip.io (or a real domain) in that file
   sudo ln -s /etc/nginx/sites-available/voice-nexus /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d YOUR_HOST

2. Point Twilio + the TwiML app at the new public HTTPS URL (same script you already use with ngrok):
   npm run twilio:setup --workspace=apps/server -- https://YOUR_HOST

3. Restart the server so it picks up the new PUBLIC_BASE_URL written to .env:
   pm2 restart vn-server

4. Smoke-test for free before placing a real call:
   npm run twilio:smoke --workspace=apps/server
EOF
