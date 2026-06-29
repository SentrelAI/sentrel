#!/usr/bin/env bash
#
# Re-add GitHub Actions secrets after transferring the repo to SentrelAI.
#
# WHY: GitHub does NOT carry Actions secrets (repository OR environment) across a
# repo transfer — they're dropped for security. Org-scoped secrets don't follow
# either. So CI/deploy stays broken until these are re-created in the new repo.
# This script re-adds them in one shot from your local source of truth.
#
# USAGE:
#   ./scripts/migrate-secrets-to-sentrelai.sh <secrets.env> [<repo>] [<pem-dir>]
#
#   <secrets.env>  KEY=VALUE per line — your source of truth for SINGLE-LINE
#                  secrets (export from your password manager, or reuse the
#                  values you already have). NEVER commit this file.
#   <repo>         target repo (default: SentrelAI/sentrel)
#   <pem-dir>      dir holding the 3 MULTI-LINE secrets as files (default: ./pem):
#                    SSH_DEPLOY_KEY  CERTIFICATE_PEM  PRIVATE_KEY_PEM
#                  (these can't live in a one-line KEY=VALUE file)
#
# Requires: gh (authenticated with a token that has repo admin on <repo>).
set -euo pipefail

SRC="${1:?path to a KEY=VALUE env file}"
REPO="${2:-SentrelAI/sentrel}"
PEM_DIR="${3:-./pem}"

# Single-line secrets — read straight from the env file.
SINGLE_LINE=(
  ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY
  ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT
  ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY
  ANTHROPIC_API_KEY
  AWS_ACCESS_KEY_ID
  AWS_ACCOUNT_ID
  AWS_SECRET_ACCESS_KEY
  BETTERSTACK_SOURCE_TOKEN
  CLOUDFLARE_ACCOUNT_ID
  CLOUDFLARE_API_KEY
  COMPOSIO_API_KEY
  DATABASE_URL
  ENGINE_API_SECRET
  ENGINE_DATABASE_URL
  ENGINE_IMAGE
  ENGINE_REDIS_URL
  FLY_API_TOKEN
  FLY_ORG_SLUG
  FLY_REGION
  GH_TOKEN
  GOOGLE_OAUTH_CLIENT_ID
  GOOGLE_OAUTH_CLIENT_SECRET
  KAMAL_REGISTRY_PASSWORD
  NANGO_SECRET_KEY
  OPENAI_API_KEY
  OPENROUTER_API_KEY
  PLAUSIBLE_SCRIPT_ID
  PREFIXED_IDS_SALT
  RAILS_MASTER_KEY
  REDIS_URL
  SENTRY_DSN
  SKILLS_SH_API_KEY
  SLACK_CLIENT_ID
  SLACK_CLIENT_SECRET
  SLACK_SIGNING_SECRET
  TWILIO_ACCOUNT_SID
  TWILIO_AUTH_TOKEN
  TWILIO_SERVICE_SID
)

# Multi-line secrets — read from files in <pem-dir>.
FILE_BASED=(
  SSH_DEPLOY_KEY
  CERTIFICATE_PEM
  PRIVATE_KEY_PEM
)

echo "Target repo: $REPO"
echo "Source file: $SRC"
echo

missing=()

for name in "${SINGLE_LINE[@]}"; do
  # take everything after the first '=' so values containing '=' survive
  val="$(grep -E "^${name}=" "$SRC" | head -1 | cut -d= -f2-)"
  if [ -z "${val}" ]; then
    missing+=("$name (not in $SRC)")
    continue
  fi
  printf '%s' "$val" | gh secret set "$name" --repo "$REPO" --body -
  echo "  ✓ $name"
done

for name in "${FILE_BASED[@]}"; do
  f="$PEM_DIR/$name"
  if [ ! -f "$f" ]; then
    missing+=("$name (expected file $f)")
    continue
  fi
  gh secret set "$name" --repo "$REPO" < "$f"
  echo "  ✓ $name (from $f)"
done

echo
if [ ${#missing[@]} -gt 0 ]; then
  echo "⚠ Skipped (set these manually before deploying):"
  for m in "${missing[@]}"; do echo "   - $m"; done
  exit 1
fi
echo "All ${#SINGLE_LINE[@]} single-line + ${#FILE_BASED[@]} file secrets set on $REPO."
echo "Verify: gh secret list --repo $REPO"
