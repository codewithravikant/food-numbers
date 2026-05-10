#!/bin/sh
set -e

# Run from the app directory (standalone layout: server.js lives next to this file).
cd "$(dirname "$0")" || exit 1

# npm/npx write update notices to stderr; hosts like Railway surface stderr as [error].
export NPM_CONFIG_UPDATE_NOTIFIER=false

if [ ! -f server.js ]; then
  echo "start.sh: server.js not found. Build with standalone output (e.g. npm run build) or use the Docker image." >&2
  exit 1
fi

echo "Running database migrations..."
if [ -x ./node_modules/.bin/prisma ]; then
  if ! ./node_modules/.bin/prisma migrate deploy; then
    echo "start.sh: prisma migrate deploy failed." >&2
    exit 1
  fi
else
  if ! npx prisma migrate deploy; then
    echo "start.sh: prisma migrate deploy failed." >&2
    exit 1
  fi
fi

echo "Starting FitNexus..."
exec node server.js
