# ---------- Base image ----------
FROM node:20-alpine AS base
WORKDIR /app

# Prisma/OpenSSL + general TLS (harmless even if not using Prisma)
RUN apk add --no-cache openssl

# ---------- Dependencies layer ----------
FROM base AS deps

# Copy only package manifests for better cache usage
COPY package*.json ./

# If you use pnpm/yarn, adjust accordingly
RUN npm ci

# ---------- Build layer ----------
FROM base AS build

COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules

# Copy the full source
COPY . .

# Build TypeScript -> dist/
# Assumes "build" script exists in package.json
RUN npm run build

# ---------- Runtime layer ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Runtime deps (you can later switch to pruned prod deps if you like)
COPY --from=deps /app/node_modules ./node_modules

# Built JS
COPY --from=build /app/dist ./dist

# Prisma schema/migrations if you use Prisma
COPY --from=build /app/prisma ./prisma

# Start script
COPY start.sh ./start.sh
RUN chmod +x ./start.sh

# Default internal port (Railway will override PORT env var)
ENV PORT=4000
EXPOSE 4000

# Single entrypoint
CMD ["./start.sh"]
