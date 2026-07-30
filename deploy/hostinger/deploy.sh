#!/usr/bin/env bash
set -euo pipefail

# Déploie Klanvio API sur le VPS Hostinger (à côté d'Evolution API)
# Prérequis: ssh, rsync, accès root/sudo sur le VPS
#
# Usage:
#   export HOSTINGER_SSH=root@srv1820011.hstgr.cloud
#   export HOSTINGER_APP_DIR=/opt/klanvio
#   npm run deploy:hostinger

SSH="${HOSTINGER_SSH:-root@srv1820011.hstgr.cloud}"
APP_DIR="${HOSTINGER_APP_DIR:-/opt/klanvio}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "🚀 Déploiement Klanvio → $SSH:$APP_DIR"

# Build panneau ops (artefacts → public/ops)
echo "📦 Build admin /ops…"
(
  cd "$ROOT_DIR/admin"
  npm install
  npm run build
)

rsync -avz --delete \
  --exclude node_modules \
  --exclude admin/node_modules \
  --exclude data \
  --exclude .env \
  --exclude .git \
  --exclude web/node_modules \
  "$ROOT_DIR/" "$SSH:$APP_DIR/"

ssh "$SSH" bash -s <<EOF
set -euo pipefail
cd "$APP_DIR"
if [ ! -f .env ]; then
  echo "⚠️  Créez $APP_DIR/.env (voir deploy/hostinger/env.example)"
  cp deploy/hostinger/env.example .env
fi
npm install --omit=dev
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi
pm2 startOrReload deploy/hostinger/ecosystem.config.cjs
pm2 save
echo "✅ Klanvio API sur le port 3001"
echo "📌 Ops UI : \$PUBLIC_URL/ops (ADMIN_EMAIL / ADMIN_PASSWORD dans .env)"
EOF

echo "📌 Configurez Nginx (deploy/hostinger/nginx-klanvio.conf) puis certbot si HTTPS requis."
echo "📌 Ops : https://api.klanvio.com/ops — variables ADMIN_EMAIL + ADMIN_PASSWORD"
echo "📌 Netlify/Vercel: ne doit PAS exposer /ops"
