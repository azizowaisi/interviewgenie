# Production-style image (also used for local full-stack compose).
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Baked into middleware + client (override with docker build --build-arg …)
ARG NEXT_PUBLIC_PUBLIC_APP_URL=https://interviewgenie.teckiz.com
ARG NEXT_PUBLIC_ADMIN_SITE_URL=https://admin.interviewgenie.teckiz.com
ARG NEXT_PUBLIC_ADMIN_HOSTS=admin.interviewgenie.teckiz.com
ARG NEXT_PUBLIC_MAIN_APP_HOSTS=interviewgenie.teckiz.com,www.interviewgenie.teckiz.com
ENV NEXT_PUBLIC_PUBLIC_APP_URL=$NEXT_PUBLIC_PUBLIC_APP_URL
ENV NEXT_PUBLIC_ADMIN_SITE_URL=$NEXT_PUBLIC_ADMIN_SITE_URL
ENV NEXT_PUBLIC_ADMIN_HOSTS=$NEXT_PUBLIC_ADMIN_HOSTS
ENV NEXT_PUBLIC_MAIN_APP_HOSTS=$NEXT_PUBLIC_MAIN_APP_HOSTS
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3002
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3002
CMD ["node", "server.js"]
