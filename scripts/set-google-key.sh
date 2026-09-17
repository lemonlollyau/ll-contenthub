#!/bin/sh
# Adds the Google service account key to .env.local without printing it.
# Usage: sh scripts/set-google-key.sh ~/Downloads/your-key-file.json
set -e
KEY_FILE="$1"
[ -f "$KEY_FILE" ] || { echo "Can't find $KEY_FILE"; exit 1; }
cd "$(dirname "$0")/.."
touch .env.local
ENCODED=$(base64 -i "$KEY_FILE" | tr -d '\n')
grep -v '^GOOGLE_SERVICE_ACCOUNT_JSON_BASE64=' .env.local > .env.local.tmp || true
echo "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64=$ENCODED" >> .env.local.tmp
mv .env.local.tmp .env.local
EMAIL=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).client_email)" "$KEY_FILE")
echo "Saved. Clients should share their Drive folder (Viewer) with: $EMAIL"
