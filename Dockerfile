FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json* ./
# Use BuildKit cache for faster rebuilds (Docker Desktop supports this).
RUN --mount=type=cache,id=cacheKey-npm,target=/root/.npm npm ci --legacy-peer-deps --no-audit --no-fund

# Rebuild the source code only when needed
FROM base AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules

# Copy Prisma files first so `prisma generate` is cached unless Prisma changes.
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts

# Default allows prisma generate when build arg is unset (matches prisma.config.ts fallback)
ARG DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy
ENV DATABASE_URL=${DATABASE_URL}

# Generate Prisma client
RUN npx prisma generate

# Now copy the rest of the app (this is what changes most often).
COPY . .

# Build Next.js
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
RUN apk add --no-cache openssl
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
# Exercise dataset (read at runtime by API / server components)
COPY --from=builder /app/data ./data

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Copy standalone Next.js output FIRST
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy Prisma schema, config, and migrations for runtime migrate deploy
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Copy generated Prisma client for the app runtime
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/node_modules/@prisma/adapter-pg ./node_modules/@prisma/adapter-pg

# Install Prisma CLI + dotenv for runtime migrations.
# Prisma is usually a devDependency, so we temporarily override NODE_ENV.
RUN --mount=type=cache,id=cacheKey-npm,target=/root/.npm NODE_ENV=development npm install --no-save prisma dotenv --legacy-peer-deps --no-audit --no-fund

# Copy startup script
COPY --chown=nextjs:nodejs start.sh ./start.sh
RUN chmod +x start.sh

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["./start.sh"]
