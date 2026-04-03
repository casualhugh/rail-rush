#!/bin/bash
# =============================================================================
# Rail Rush — EC2 Setup Script
# =============================================================================
# Usage: sudo bash setup-ec2.sh [--repo-url <url>]
#
# Prerequisites (EC2 Security Group must allow):
#   - Port 22  (SSH)
#   - Port 80  (HTTP — required for Let's Encrypt ACME challenge)
#   - Port 443 (HTTPS — PocketBase TLS)
#
# After running this script you still need to:
#   1. Set up your PocketBase superuser via the admin UI or CLI
#   2. Point api.railrushgame.com DNS → this instance's public IP
#      (DNS must resolve BEFORE Let's Encrypt can issue a cert)
# =============================================================================
set -euo pipefail

# --- Config ------------------------------------------------------------------
REPO_URL="${REPO_URL:-}"         # Set via env var or --repo-url flag below
API_DOMAIN="api.railrushgame.com"
APP_USER="railrush"
APP_DIR="/opt/rail-rush"
PB_VERSION="0.36.7"
PB_LINUX_BINARY="pocketbase_${PB_VERSION}_linux_amd64.zip"
PB_DOWNLOAD_URL="https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/${PB_LINUX_BINARY}"

# --- Parse args --------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-url) REPO_URL="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

if [[ -z "$REPO_URL" ]]; then
  echo "ERROR: REPO_URL is required."
  echo "  Usage: sudo REPO_URL=https://github.com/you/rail-rush.git bash setup-ec2.sh"
  echo "     or: sudo bash setup-ec2.sh --repo-url https://github.com/you/rail-rush.git"
  exit 1
fi

# --- Guards ------------------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
  echo "ERROR: This script must be run as root (use sudo)."
  exit 1
fi

echo ""
echo "=== Rail Rush EC2 Setup ==="
echo "    Repo:    $REPO_URL"
echo "    Domain:  $API_DOMAIN"
echo "    User:    $APP_USER"
echo "    Dir:     $APP_DIR"
echo "    PB:      v$PB_VERSION"
echo ""

# =============================================================================
# Step 1 — System packages
# =============================================================================
echo "[1/8] Installing system packages..."
yum update -qq
yum install -y -qq \
  git \
  unzip \
  curl \
  libcap2-bin \
  ufw

# Node.js 20 LTS via NodeSource
if ! command -v node &>/dev/null; then
  echo "      Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - &>/dev/null
  yum install -y -qq nodejs
fi
echo "      node $(node --version)  npm $(npm --version)"

# =============================================================================
# Step 2 — Dedicated app user
# =============================================================================
echo "[2/8] Creating app user '$APP_USER'..."
if ! id "$APP_USER" &>/dev/null; then
  # System account: no password, no login shell, home at APP_DIR
  useradd \
    --system \
    --shell /usr/sbin/nologin \
    --home-dir "$APP_DIR" \
    --create-home \
    --comment "Rail Rush service account" \
    "railrush"
  echo "      User '$APP_USER' created."
else
  echo "      User '$APP_USER' already exists, skipping."
fi

# =============================================================================
# Step 3 — Clone / update repository
# =============================================================================
echo "[3/8] Cloning repository..."
if [[ -d "$APP_DIR/.git" ]]; then
  echo "      Repo already exists — pulling latest..."
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
else
  # Clone into a temp dir as root, then move and chown
  # (avoids SSH key issues for the system user)
  TMP_CLONE=$(mktemp -d)
  git clone --depth=1 "$REPO_URL" "$TMP_CLONE/rail-rush"
  rm -rf "$APP_DIR"
  mv "$TMP_CLONE/rail-rush" "$APP_DIR"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  rm -rf "$TMP_CLONE"
  echo "      Cloned to $APP_DIR"
fi

# =============================================================================
# Step 4 — Download Linux PocketBase binary
# =============================================================================
echo "[4/8] Setting up PocketBase v$PB_VERSION (Linux AMD64)..."
PB_BIN="$APP_DIR/backend/pocketbase"

if [[ -f "$PB_BIN" ]]; then
  echo "      Linux binary already present, skipping download."
else
  TMP_DL=$(mktemp -d)
  echo "      Downloading $PB_DOWNLOAD_URL ..."
  curl -fsSL "$PB_DOWNLOAD_URL" -o "$TMP_DL/$PB_LINUX_BINARY"
  unzip -q "$TMP_DL/$PB_LINUX_BINARY" pocketbase -d "$TMP_DL"
  mv "$TMP_DL/pocketbase" "$PB_BIN"
  chmod +x "$PB_BIN"
  chown "$APP_USER:$APP_USER" "$PB_BIN"
  rm -rf "$TMP_DL"
  echo "      Saved to $PB_BIN"
fi

# Grant the binary permission to bind privileged ports (< 1024) without root.
# This replaces running as root entirely and is the recommended safe approach.
echo "      Granting cap_net_bind_service to binary..."
setcap 'cap_net_bind_service=+ep' "$PB_BIN"
echo "      $(getcap "$PB_BIN")"

# Ensure pb_data is owned by the app user (persisted SQLite + uploads)
mkdir -p "$APP_DIR/backend/pb_data"
chown -R "$APP_USER:$APP_USER" "$APP_DIR/backend/pb_data"
chmod 700 "$APP_DIR/backend/pb_data"

# =============================================================================
# Step 5 — Build frontend
# =============================================================================
echo "[5/8] Building frontend..."
cd "$APP_DIR/frontend"

# Write the production env file (overwrite any local dev config)
cat > .env.local <<EOF
VITE_PB_URL=https://${API_DOMAIN}
EOF
chown "$APP_USER:$APP_USER" .env.local

echo "      npm install..."
npm ci --silent

echo "      npm run build..."
npm run build

echo "      Build complete → $APP_DIR/frontend/dist/"

# Copy the built SPA into PocketBase's public folder so it is served from
# https://api.railrushgame.com/ alongside the API.
# Remove this block if you prefer to host the frontend separately.
echo "      Copying dist → backend/pb_public/..."
mkdir -p "$APP_DIR/backend/pb_public"
cp -r dist/. "$APP_DIR/backend/pb_public/"
chown -R "$APP_USER:$APP_USER" "$APP_DIR/backend/pb_public"

cd - > /dev/null

# =============================================================================
# Step 6 — Systemd service
# =============================================================================
echo "[6/8] Installing systemd service..."
cat > /etc/systemd/system/rail-rush.service <<EOF
[Unit]
Description=Rail Rush (PocketBase)
Documentation=https://pocketbase.io
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}/backend

# PocketBase serves HTTPS directly via Let's Encrypt.
# On first start (or after cert expiry) it will auto-obtain a cert for
# ${API_DOMAIN} — port 80 must be reachable from the internet at that point.
ExecStart=${PB_BIN} serve \
    --http=0.0.0.0:80 \
    --https=${API_DOMAIN}:443

Restart=on-failure
RestartSec=5
TimeoutStopSec=30

# --- Hardening ---
NoNewPrivileges=yes
PrivateTmp=yes
ProtectHome=yes
ProtectSystem=strict
# Allow writes only to pb_data and pb_public
ReadWritePaths=${APP_DIR}/backend/pb_data ${APP_DIR}/backend/pb_public
# Keep the cap_net_bind_service capability inside the service unit
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable rail-rush
echo "      Service installed and enabled."

# =============================================================================
# Step 7 — Firewall
# =============================================================================
echo "[7/8] Configuring UFW firewall..."
# Allow SSH first so we don't lock ourselves out
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
# Enable non-interactively (default deny incoming, allow outgoing)
ufw --force enable
echo "      $(ufw status verbose | head -5)"

# =============================================================================
# Step 8 — Start service
# =============================================================================
echo "[8/8] Starting rail-rush service..."
systemctl start rail-rush

sleep 3
if systemctl is-active --quiet rail-rush; then
  echo "      Service is running."
else
  echo "      WARNING: Service failed to start. Check logs:"
  echo "        journalctl -u rail-rush -n 50 --no-pager"
  exit 1
fi

# =============================================================================
# Done
# =============================================================================
echo ""
echo "=== Setup complete ==="
echo ""
echo "  Service:  systemctl status rail-rush"
echo "  Logs:     journalctl -u rail-rush -f"
echo "  Admin UI: https://${API_DOMAIN}/_/"
echo ""
echo "  Next steps:"
echo "  1. Ensure DNS for ${API_DOMAIN} points to this instance's public IP."
echo "     Let's Encrypt cannot issue a cert until DNS resolves correctly."
echo "  2. Create your PocketBase superuser:"
echo "       sudo -u ${APP_USER} ${PB_BIN} superuser create <email> <password>"
echo "  3. Visit https://${API_DOMAIN}/_/ to confirm the admin UI loads over HTTPS."
echo ""
echo "  To update the app later, run this script again with the same arguments."
echo "  It will git-pull, rebuild the frontend, and restart the service."
echo ""
