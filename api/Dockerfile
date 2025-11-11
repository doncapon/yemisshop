# ---------- Base image ----------
FROM node:20-alpine AS base
WORKDIR /app

# Needed for Prisma binary & general TLS stuff (safe even if not using Prisma)
RUN apk add --no-cache openssl

# ---------- Dependencies layer ----------
FROM base AS deps

# Copy only package manifests first (better cache)
COPY package*.json ./

# If you use pnpm/yarn, swap this accordingly
RUN npm ci

# ---------- Build layer ----------
FROM base AS build

COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules

# Copy the rest of the source
COPY . .

# Build TypeScript -> dist/
# Make sure "build" exists in package.json (e.g. "tsc")
RUN npm run build

# ---------- Runtime layer ----------
FROM base AS runner

ENV NODE_ENV=production

WORKDIR /app

# Copy built JS
COPY --from=build /app/dist ./dist

# Copy node_modules from deps (production+dev is fine for now; can be pruned later)
COPY --from=deps /app/node_modules ./node_modules

# If you use Prisma, keep schema & migrations so generate/migrate works in pre-deploy
COPY prisma ./prisma

# Default port INSIDE the container.
# Railway will inject $PORT and you should respect it in env.port.
ENV PORT=4000
EXPOSE 4000

# Start the compiled server
# Assumes src/server.ts -> dist/server.js
CMD ["node", "dist/server.js"]
