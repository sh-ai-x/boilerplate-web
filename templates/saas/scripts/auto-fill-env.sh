#!/usr/bin/env bash
#
# scripts/auto-fill-env.sh - auto-populate .env.local from Supabase + Vercel + Cloudflare APIs.
#
# When the corresponding MCP tokens (or API tokens) are in the shell env,
# this script queries the live APIs and writes the actual values into .env.local,
# overwriting the placeholder values from .env.example.
#
# Idempotent: re-running is safe. If a token is missing, that section is
# skipped silently (operator can fill the value by hand in their editor).
#
# Usage:
#   ./scripts/auto-fill-env.sh                 # fill what we can
#   ./scripts/auto-fill-env.sh --dry-run      # preview what would be filled
#
# Tokens read from env:
#   SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF  -> fills NEXT_PUBLIC_*_KEY, _URL
#   VERCEL_TOKEN                                  -> fills VERCEL_ORG_ID
#   CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID  -> nothing auto-fillable
#                                                    (zone ID is per-domain, picked later)
#
# See SETUP.md for the full token catalog.

set -euo pipefail

ACTION="run"
if [[ "${1:-}" == "--dry-run" ]]; then ACTION="dry-run"; fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT/.env.local"

emit() { echo "+ $*"; }

run() {
  if [[ "$ACTION" == "dry-run" ]]; then
    emit "$@"
  else
    eval "$@"
  fi
}

# Update one key in the .env.local file, preserving everything else.
# Usage: set_key KEY VALUE
set_key() {
  local key="$1" val="$2"
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "  X $ENV_FILE missing - run \`cp .env.example .env.local\` first" >&2
    return 1
  fi
  # Replace if the key already exists; otherwise append.
  if grep -qE "^${key}=" "$ENV_FILE"; then
    # BSD sed requires -i '' ; GNU sed uses -i. Detect.
    if sed --version >/dev/null 2>&1; then
      # GNU sed (Linux / nix)
      run sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
    else
      # BSD sed (macOS) - needs empty string arg
      run sed -i '' "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
    fi
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

echo "[auto-fill-env] filling .env.local from API tokens where available"

# ---- Supabase ----
if [[ -n "${SUPABASE_ACCESS_TOKEN:-}" && -n "${SUPABASE_PROJECT_REF:-}" ]]; then
  echo "[auto-fill-env] Supabase tokens found - fetching project + API keys"
  PROJECT_JSON=$(curl -fsSL \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    -H "apikey: ${SUPABASE_ACCESS_TOKEN}" \
    "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}" 2>/dev/null || echo "")
  if [[ -n "$PROJECT_JSON" ]]; then
    URL=$(printf '%s' "$PROJECT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('endpoint',''))" 2>/dev/null)
    set_key "NEXT_PUBLIC_SUPABASE_URL" "$URL"
    echo "  + NEXT_PUBLIC_SUPABASE_URL = $URL"
  else
    echo "  ! could not fetch project endpoint (verify SUPABASE_PROJECT_REF is correct)"
  fi
  KEYS_JSON=$(curl -fsSL \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    -H "apikey: ${SUPABASE_ACCESS_TOKEN}" \
    "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/api-keys?reveal=false" 2>/dev/null || echo "")
  if [[ -n "$KEYS_JSON" ]]; then
    ANON=$(printf '%s' "$KEYS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(next((k.get('api_key','') for k in d if k.get('name')=='anon'), ''))" 2>/dev/null)
    SR=$(printf '%s' "$KEYS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(next((k.get('api_key','') for k in d if k.get('name')=='service_role'), ''))" 2>/dev/null)
    if [[ -n "$ANON" ]]; then
      set_key "NEXT_PUBLIC_SUPABASE_ANON_KEY" "$ANON"
      echo "  + NEXT_PUBLIC_SUPABASE_ANON_KEY (from Supabase API)"
    fi
    if [[ -n "$SR" ]]; then
      set_key "SUPABASE_SERVICE_ROLE_KEY" "$SR"
      echo "  + SUPABASE_SERVICE_ROLE_KEY (from Supabase API)"
    fi
  else
    echo "  ! could not fetch API keys (may need a different token scope)"
  fi
else
  echo "[auto-fill-env] Supabase tokens not in env - skipping (operator fills these in .env.local by hand)"
fi

# ---- Vercel ----
if [[ -n "${VERCEL_TOKEN:-}" ]]; then
  echo "[auto-fill-env] VERCEL_TOKEN found - fetching account info"
  ME_JSON=$(curl -fsSL \
    -H "Authorization: Bearer ${VERCEL_TOKEN}" \
    "https://api.vercel.com/v2/user" 2>/dev/null || echo "")
  if [[ -n "$ME_JSON" ]]; then
    ORG_ID=$(printf '%s' "$ME_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin).get('user',{}); print(d.get('id',''))" 2>/dev/null)
    if [[ -n "$ORG_ID" ]]; then
      set_key "VERCEL_ORG_ID" "$ORG_ID"
      echo "  + VERCEL_ORG_ID = $ORG_ID"
    fi
  else
    echo "  ! could not fetch Vercel user info (verify VERCEL_TOKEN is valid)"
  fi
else
  echo "[auto-fill-env] VERCEL_TOKEN not in env - skipping (operator fills VERCEL_ORG_ID by hand)"
fi

# ---- Cloudflare ----
# CLOUDFLARE_ACCOUNT_ID is already set by the user (they got it from the dashboard).
# We could verify it via GET /accounts/:id but it's not strictly needed.
if [[ -n "${CLOUDFLARE_API_TOKEN:-}" && -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "[auto-fill-env] Cloudflare tokens found - verifying"
  CF_VERIFY=$(curl -fsSL \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}" 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok' if d.get('success') else 'fail')" 2>/dev/null || echo "fail")
  if [[ "$CF_VERIFY" == "ok" ]]; then
    echo "  + CLOUDFLARE_ACCOUNT_ID verified"
  else
    echo "  ! CLOUDFLARE_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID may be wrong (verify in dashboard)"
  fi
else
  echo "[auto-fill-env] Cloudflare tokens not in env - skipping (operator fills in by hand)"
fi

echo "[auto-fill-env] done"
