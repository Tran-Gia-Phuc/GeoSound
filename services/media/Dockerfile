# Build context = repo root (see docker-compose.yml) so ./shared can be copied.
# Targets: `dev` (nodemon, used by docker-compose.dev.yml) and `prod` (default, last stage).
# Deployment plan: docs/02-design/deployment-plan.md, task 0.2.
# HTTP upload of images / audio (POST /uploads) + dev file serving (GET /files/*).
# Dev files live in /data/media (a volume, so they survive a new container).

FROM node:20-alpine AS base
WORKDIR /app
COPY services/media/package*.json ./
COPY shared/package.json ./shared/

# Dev image: all dependencies (nodemon); docker-compose.dev.yml mounts src/ and shared/.
FROM base AS dev
RUN npm install --no-audit --no-fund --loglevel=error
# Monorepo: shared has its own dependencies (jsonwebtoken for verifyJwt, amqplib, zod).
RUN npm install --omit=dev --no-audit --no-fund --loglevel=error --prefix ./shared
COPY services/media/src ./src
COPY services/media/prisma ./prisma
COPY shared ./shared
RUN mkdir -p /data/media
EXPOSE 3005
CMD ["npm", "start"]

# Runtime dependencies only. npm installs the prisma CLI and its engines (about 55 MB) as a
# peer of @prisma/client; media does not run Prisma at all, so they are removed.
FROM base AS prod-deps
RUN npm install --omit=dev --no-audit --no-fund --loglevel=error \
 && rm -rf node_modules/prisma node_modules/.bin/prisma node_modules/@prisma/debug \
      node_modules/@prisma/engines node_modules/@prisma/engines-version \
      node_modules/@prisma/fetch-engine node_modules/@prisma/get-platform \
 && npm install --omit=dev --no-audit --no-fund --loglevel=error --prefix ./shared

FROM node:20-alpine AS prod
WORKDIR /app
# npm 11 instead of the npm 10.8 bundled with Node 20 (task 1.2, #364): its dependencies (tar,
# glob, sigstore, ...) were the CRITICAL and most HIGH findings of the image scan. npm stays, the
# team runs `npx prisma ...` in these containers. apk upgrade: Node 20 is end of life, its images
# are no longer rebuilt.
RUN npm install -g npm@11.21.2 --no-audit --no-fund --loglevel=error \
 && npm cache clean --force && rm -rf /root/.npm /tmp/* \
 && apk upgrade --no-cache
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/shared/node_modules ./shared/node_modules
COPY services/media/package.json ./
COPY services/media/prisma ./prisma
COPY services/media/src ./src
COPY shared ./shared
# The upload directory is the only path the app writes; it belongs to `node`.
RUN mkdir -p /data/media && chown node:node /data/media
# Other files stay owned by root (read-only for the app); the process runs as `node`.
USER node
EXPOSE 3005
# node directly (no npm wrapper) so SIGTERM reaches the process.
CMD ["node", "src/index.js"]
