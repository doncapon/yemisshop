# ---------- Base image ----------
FROM node:20-alpine AS base
WORKDIR /app

# TLS + Prisma runtime deps
# libc6-compat is a common fix for native modules on alpine
RUN apk add --no-cache openssl libc6-compat

# ---------- Dependencies layer ----------
FROM base AS deps

# Copy only package manifests for better cache usage
COPY package*.json ./

# Install ALL deps (keep dev deps because we run prisma CLI at runtime)
RUN npm ci

# Bring prisma now so we can generate the client into node_modules
COPY prisma ./prisma

# Generate Prisma client artifacts into node_modules/@prisma/*
RUN npx prisma generate

# ---------- Build layer ----------
FROM base AS build

# Reuse deps (including generated Prisma client)
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./

# Copy the full source
COPY . .

# Build TypeScript -> dist/
RUN npm run build

# ---------- Runtime layer ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Keep the same system libs as base
RUN apk add --no-cache openssl libc6-compat

# Copy runtime deps (with generated Prisma client inside)
COPY --from=deps /app/node_modules ./node_modules

# Built JS
COPY --from=build /app/dist ./dist

# Prisma schema & migrations are required for migrate/seed at runtime
COPY --from=build /app/prisma ./prisma

# Start script
COPY start.sh ./start.sh
RUN chmod +x ./start.sh

# Default internal port (Railway will set PORT)
ENV PORT=4000
EXPOSE 4000

# One entrypoint
CMD ["./start.sh"]
