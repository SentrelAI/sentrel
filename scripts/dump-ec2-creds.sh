#!/usr/bin/env bash
#
# Dump the live application secrets from the running Kamal container on the EC2
# host, into a `secrets.env` file you can feed to migrate-secrets-to-sentrelai.sh
# when moving the repo to the SentrelAI org (GitHub drops Actions secrets on
# transfer, so they must be re-added).
#
# RUN THIS ON THE EC2 HOST (ssh ubuntu@52.2.137.107), not your laptop:
#   curl -fsSL <this script> -o dump.sh   # or scp it over
#   bash dump.sh                          # writes ./secrets.env (chmod 600)
#
# Source of truth: the secrets are injected as env vars into the running Rails
# container at `docker run`, so the container's own environment is authoritative.
#
# ⚠️ secrets.env contains PLAINTEXT credentials. It's chmod 600 and must NEVER be
#    committed or left on the box — scp it down, use it, shred it.
set -euo pipefail

OUT="${1:-secrets.env}"

# The app secrets we care about (mirrors app-deploy.yml). DEPLOY-ONLY secrets
# (SSH_DEPLOY_KEY, KAMAL_REGISTRY_PASSWORD) are NOT in the running container —
# they live only in CI/your password manager. CERTIFICATE_PEM / PRIVATE_KEY_PEM
# are multi-line and handled separately (see note at the end).
NAMES=(
  RAILS_MASTER_KEY DATABASE_URL REDIS_URL ENGINE_DATABASE_URL ENGINE_REDIS_URL
  ENGINE_API_SECRET PREFIXED_IDS_SALT NANGO_SECRET_KEY COMPOSIO_API_KEY
  ANTHROPIC_API_KEY OPENAI_API_KEY OPENROUTER_API_KEY CLOUDFLARE_API_KEY
  CLOUDFLARE_ACCOUNT_ID GH_TOKEN SKILLS_SH_API_KEY TWILIO_ACCOUNT_SID
  TWILIO_AUTH_TOKEN TWILIO_SERVICE_SID AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
  AWS_ACCOUNT_ID SENTRY_DSN FLY_API_TOKEN FLY_ORG_SLUG FLY_REGION ENGINE_IMAGE
  SLACK_CLIENT_ID SLACK_CLIENT_SECRET SLACK_SIGNING_SECRET
  ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY
  ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT GOOGLE_OAUTH_CLIENT_ID
  GOOGLE_OAUTH_CLIENT_SECRET PLAUSIBLE_SCRIPT_ID BETTERSTACK_SOURCE_TOKEN
)

# Find the running Rails web container. Kamal tags it with the service name;
# match the app image (alchemy today, sentrel after the image rename).
CID="$(docker ps --format '{{.ID}} {{.Image}} {{.Names}}' \
  | grep -Ei 'alchemy|sentrel' \
  | grep -Eiv 'vector|nango|redis|postgres' \
  | grep -Ei 'web|rails|-web-' \
  | head -1 | awk '{print $1}')"

# Fallback: any container whose image is the app image.
if [ -z "${CID}" ]; then
  CID="$(docker ps --format '{{.ID}} {{.Image}}' | grep -Ei 'parsedev/alchemy|sentrelai/sentrel' | grep -vi engine | head -1 | awk '{print $1}')"
fi

if [ -z "${CID}" ]; then
  echo "✗ Could not find the running Rails container. Inspect manually:" >&2
  docker ps --format '  {{.ID}}  {{.Image}}  {{.Names}}' >&2
  exit 1
fi

echo "Using container: $CID ($(docker ps --format '{{.Image}}' -f id=$CID))"
ENV_DUMP="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$CID")"

umask 077
: > "$OUT"
found=0; missing=()
for name in "${NAMES[@]}"; do
  line="$(printf '%s\n' "$ENV_DUMP" | grep -E "^${name}=" | head -1 || true)"
  if [ -n "$line" ]; then
    printf '%s\n' "$line" >> "$OUT"
    found=$((found+1))
  else
    missing+=("$name")
  fi
done
chmod 600 "$OUT"

echo "✓ Wrote $found secrets to $OUT (chmod 600)."
if [ ${#missing[@]} -gt 0 ]; then
  echo "ℹ Not in the container env (get these from CI / your password manager):"
  printf '   - %s\n' "${missing[@]}"
fi
cat <<'NOTE'

Next:
  1. scp this file down:   scp ubuntu@52.2.137.107:~/secrets.env ./secrets.env
  2. shred it on the box:  shred -u secrets.env
  3. Multi-line secrets for the new org are NOT here — put SSH_DEPLOY_KEY,
     CERTIFICATE_PEM, PRIVATE_KEY_PEM as files under ./pem/ from your own copies.
  4. Re-add to SentrelAI:  ./scripts/migrate-secrets-to-sentrelai.sh secrets.env SentrelAI/sentrel ./pem
NOTE
