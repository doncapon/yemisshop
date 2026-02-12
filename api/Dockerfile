# ---------- Base image ----------
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat

# ---------- Dependencies layer ----------
FROM base AS deps
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
RUN ./node_modules/.bin/prisma generate

# ---------- Build layer ----------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY . .
RUN npm run build

# ---------- Runtime layer ----------
FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat

ENV NODE_ENV=production
ENV PORT=8080
# ✅ default: seed runs. Set RUN_SEED=false in Railway if you want to disable.
ENV RUN_SEED=false

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json

COPY start.sh ./start.sh
RUN chmod +x ./start.sh

EXPOSE 8080
CMD ["sh", "./start.sh"]
