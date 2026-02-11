#!/bin/sh
# start.sh - entrypoint for Railway API container

set -e

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# 1) Ensure PORT is set (Railway injects it; default for local/Docker)
export PORT="${PORT:-8080}"

log "Starting API on port $PORT"

# 2) Run Prisma migrations if Prisma is present
if [ -d "prisma" ]; then
  if command -v npx >/dev/null 2>&1; then
    log "Running Prisma migrations (prisma migrate deploy)..."
    npx prisma migrate deploy || {
      log "WARNING: prisma migrate deploy failed. Continuing without applying migrations."
    }
  else
    log "npx not found; skipping Prisma migrations."
  fi
fi

# 3) Sanity check for built server
if [ ! -f "dist/src/server.js" ]; then
  log "ERROR: dist/src/server.js not found. Did you run 'npm run build' during the image build?"
  ls -R
  exit 1
fi

# 4) Start the Node server
log "Launching Node server..."
exec node dist/src/server.js
