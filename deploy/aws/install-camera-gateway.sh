#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/home/ubuntu/alpasfarm}"
GATEWAY_DIR="$REPO_ROOT/camera-gateway"
MODEL_PATH="/var/lib/alpasfarm-camera-gateway/models/best.pt"
PYTHON="${PYTHON:-python3}"

if [[ ! -d "$GATEWAY_DIR" ]]; then
  echo "Camera gateway source is missing: $GATEWAY_DIR" >&2
  exit 1
fi

if [[ ! -f "$MODEL_PATH" ]]; then
  echo "WARNING: goat/sheep checkpoint is missing: $MODEL_PATH" >&2
  echo "The gateway service will remain stopped until private model weights are installed." >&2
fi

sudo apt-get update
sudo apt-get install -y python3-venv libgl1 libglib2.0-0 tesseract-ocr

sudo install -d -o ubuntu -g ubuntu -m 0750 /var/lib/alpasfarm-camera-gateway
sudo install -d -o ubuntu -g ubuntu -m 0750 /var/lib/alpasfarm-camera-gateway/models

"$PYTHON" -m venv "$GATEWAY_DIR/.venv"
"$GATEWAY_DIR/.venv/bin/python" -m pip install --upgrade pip
"$GATEWAY_DIR/.venv/bin/python" -m pip install \
  --index-url https://download.pytorch.org/whl/cpu \
  torch torchvision
"$GATEWAY_DIR/.venv/bin/python" -m pip install -r "$GATEWAY_DIR/requirements.txt"
"$GATEWAY_DIR/.venv/bin/python" -m pip check

sudo install -d -o root -g ubuntu -m 0750 /etc/alpasfarm
if [[ ! -f /etc/alpasfarm/camera-gateway.env ]]; then
  sudo install -o root -g ubuntu -m 0640 \
    "$REPO_ROOT/deploy/aws/camera-gateway.env.example" \
    /etc/alpasfarm/camera-gateway.env
  echo "Created /etc/alpasfarm/camera-gateway.env from the template."
fi

sed 's/\r$//' "$REPO_ROOT/deploy/aws/camera-gateway.service" |
  sudo tee /etc/systemd/system/alpasfarm-camera-gateway.service >/dev/null
sudo chmod 0644 /etc/systemd/system/alpasfarm-camera-gateway.service
sudo systemctl daemon-reload

echo "Installed the gateway runtime. The systemd unit was not enabled or started."
echo "Configure the private VPN route and environment file before enabling the service."
