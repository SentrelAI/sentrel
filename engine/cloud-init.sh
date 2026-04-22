#!/usr/bin/env bash
# Generic cloud-init / user-data script for bare-VM providers (Hetzner, DO,
# any Linux box with Docker). Runs once on first boot.
#
# The provisioner substitutes the ${...} placeholders before passing this to
# the provider's user-data field. Values are validated by Rails beforehand so
# the machine never boots with missing secrets.
#
# Result: a single-agent VM running engine + camofox + docker compose, bound
# to the shared /data volume, auto-starting on boot, reporting health to Rails.

set -euo pipefail

###############################################################################
# Required — substituted by the provisioner before submission
###############################################################################
: "${EMPLOYEE_ID:?EMPLOYEE_ID not set in cloud-init}"
: "${DATABASE_URL:?DATABASE_URL not set}"
: "${REDIS_URL:?REDIS_URL not set}"
: "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY not set}"
: "${ENGINE_API_SECRET:?ENGINE_API_SECRET not set}"
: "${RAILS_INTERNAL_URL:?RAILS_INTERNAL_URL not set}"
: "${ENGINE_IMAGE:=ghcr.io/qubitam/alchemy-engine:latest}"
: "${CAMOFOX_IMAGE:=ghcr.io/askjo/camofox-browser:latest}"

###############################################################################
# Install Docker if missing (Hetzner's minimal images don't ship it)
###############################################################################
if ! command -v docker >/dev/null 2>&1; then
  echo ">>> Installing Docker"
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

if ! docker compose version >/dev/null 2>&1; then
  echo ">>> Installing Docker Compose plugin"
  apt-get update && apt-get install -y docker-compose-plugin
fi

###############################################################################
# Place the engine repo's docker-compose.yml on disk + write .env
###############################################################################
mkdir -p /opt/alchemy
cd /opt/alchemy

# Vendored copy of docker-compose.yml (kept in sync with the engine repo).
cat > docker-compose.yml <<'COMPOSE_EOF'
services:
  engine:
    image: ${ENGINE_IMAGE}
    restart: unless-stopped
    depends_on: [camofox]
    env_file: .env
    ports: ["3300:3300"]
    volumes: [data:/data]
  camofox:
    image: ${CAMOFOX_IMAGE}
    restart: unless-stopped
    environment:
      CAMOFOX_PORT: "9377"
      CAMOFOX_PROFILE_DIR: /data/camofox
    ports: ["9377:9377"]
    volumes: [data:/data]
    shm_size: 2gb
volumes:
  data: {}
COMPOSE_EOF

# Per-agent .env (secrets come from the provisioner's substitution)
cat > .env <<ENV_EOF
EMPLOYEE_ID=${EMPLOYEE_ID}
DATABASE_URL=${DATABASE_URL}
REDIS_URL=${REDIS_URL}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
ENGINE_API_SECRET=${ENGINE_API_SECRET}
RAILS_INTERNAL_URL=${RAILS_INTERNAL_URL}
COMPOSIO_API_KEY=${COMPOSIO_API_KEY:-}
OPENAI_API_KEY=${OPENAI_API_KEY:-}
TWILIO_ACCOUNT_SID=${TWILIO_ACCOUNT_SID:-}
TWILIO_AUTH_TOKEN=${TWILIO_AUTH_TOKEN:-}
WHATSAPP_BOT_NUMBER=${WHATSAPP_BOT_NUMBER:-}
SENTRY_DSN=${SENTRY_DSN:-}
BETTERSTACK_SOURCE_TOKEN=${BETTERSTACK_SOURCE_TOKEN:-}
ENGINE_IMAGE=${ENGINE_IMAGE}
CAMOFOX_IMAGE=${CAMOFOX_IMAGE}
DATA_DIR=/data
TOOL_ROUTING=smart
RESUME_ENABLED=true
ENV_EOF
chmod 600 .env

###############################################################################
# Pull images + start
###############################################################################
echo ">>> Pulling images"
docker compose pull

echo ">>> Starting containers"
docker compose up -d

###############################################################################
# Healthcheck — wait for the engine gateway to respond, then notify Rails
###############################################################################
echo ">>> Waiting for engine to come up"
for i in {1..60}; do
  if curl -fsS http://localhost:3300/health >/dev/null 2>&1; then
    echo ">>> Engine healthy (took ${i}s)"
    break
  fi
  sleep 1
done

# Report back to Rails that the agent's machine is ready. Rails flips
# agent_instances.status from "starting" → "running".
if [ -n "${RAILS_INTERNAL_URL:-}" ]; then
  curl -fsS -X POST "${RAILS_INTERNAL_URL}/api/agent_instances/ready" \
    -H "Content-Type: application/json" \
    -H "X-Engine-Secret: ${ENGINE_API_SECRET}" \
    -d "{\"employee_id\":${EMPLOYEE_ID},\"public_ip\":\"$(curl -fsS ifconfig.io)\"}" \
    || echo ">>> (warn) could not notify Rails — will be picked up on next health sync"
fi

echo ">>> cloud-init done"
