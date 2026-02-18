# syntax=docker/dockerfile:1

# ---------- Base image ----------
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat

# ---------- API deps ----------
FROM base AS api_deps
WORKDIR /app/api
COPY api/package*.json ./
COPY api/prisma ./prisma
RUN npm ci
RUN ./node_modules/.bin/prisma generate

# ---------- UI deps ----------
FROM base AS ui_deps
WORKDIR /app/ui
COPY ui/package*.json ./
RUN npm ci --include=dev

# ---------- Build (UI + API) ----------
FROM base AS build

# UI build args (you can override in Railway)
ARG VITE_API_URL=/api
ARG VITE_APP_URL=https://dayspringhouse.com

# ---- Build UI ----
WORKDIR /app/ui
COPY --from=ui_deps /app/ui/node_modules ./node_modules
COPY ui/ ./
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_URL=$VITE_APP_URL
RUN npm run build

# ---- Build API ----
WORKDIR /app/api
COPY --from=api_deps /app/api/node_modules ./node_modules
COPY api/ ./
RUN npm run build

# ---------- Runtime ----------
FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

# ✅ Option A: tell server.ts where the SPA build is
ENV UI_DIST_DIR=/app/ui/dist

# ✅ default: seed does NOT run (you already prefer false)
ENV RUN_SEED=false

# API runtime files
WORKDIR /app/api
COPY --from=api_deps /app/api/node_modules ./node_modules
COPY --from=build /app/api/dist ./dist
COPY --from=build /app/api/prisma ./prisma
COPY --from=build /app/api/package.json ./package.json
COPY --from=build /app/api/package-lock.json ./package-lock.json
COPY api/start.sh ./start.sh
RUN chmod +x ./start.sh

# UI build copied into runtime image
WORKDIR /app
COPY --from=build /app/ui/dist ./ui/dist

EXPOSE 8080

# Start API (which will now serve SPA too)
WORKDIR /app/api
CMD ["sh", "./start.sh"]
