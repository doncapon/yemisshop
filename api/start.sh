#!/bin/sh
set -e

echo "[boot] NODE_ENV=$NODE_ENV"

if [ -z "$DATABASE_URL" ]; then
  echo "[boot] ERROR: DATABASE_URL is not set"
  exit 1
fi

echo "[boot] Running migrations..."
./node_modules/.bin/prisma migrate deploy

# ✅ Seed on startup (toggle with RUN_SEED=false if you want)
if [ "${RUN_SEED:-true}" = "true" ]; then
  echo "[boot] Running seed..."
  npm run seed
else
  echo "[boot] Skipping seed (RUN_SEED=$RUN_SEED)"
fi

echo "[boot] Starting server..."
node dist/src/server.js
