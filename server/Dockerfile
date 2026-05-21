# Gateway Protocol — reference server image
# Tiny multi-stage build: just Node + ws, no native compilation needed.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:20-alpine
WORKDIR /app
# Run as non-root for defence in depth
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=app:app . .
USER app
# COMMIT_SHA is injected at build time by `fly deploy --build-arg COMMIT_SHA=$(git rev-parse HEAD)`
# (see server/README.md → Deploy). The landing page pins source links to this SHA.
# Defaults to 'main' so local image builds without the build-arg still produce a valid (if drifty) link.
ARG COMMIT_SHA=main
ENV COMMIT_SHA=$COMMIT_SHA
ENV NODE_ENV=production
ENV PORT=7070
EXPOSE 7070
# Use exec form so SIGTERM reaches node directly (clean shutdown on deploys)
CMD ["node", "practice-room.js"]
