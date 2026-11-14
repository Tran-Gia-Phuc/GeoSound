# Build context = gateway/ (see docker-compose.yml).
# Targets: `dev` (nodemon, used by docker-compose.dev.yml) and `prod` (default, last stage).
# Deployment plan: docs/02-design/deployment-plan.md, task 0.2.

FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./

# Dev image: all dependencies (nodemon); docker-compose.dev.yml mounts src/.
FROM base AS dev
RUN npm install --no-audit --no-fund --loglevel=error
COPY src ./src
EXPOSE 8080
CMD ["npm", "start"]

FROM base AS prod-deps
RUN npm install --omit=dev --no-audit --no-fund --loglevel=error

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
COPY package.json ./
COPY src ./src
# Files stay owned by root (read-only for the app); the process runs as `node`.
USER node
EXPOSE 8080
# node directly (no npm wrapper) so SIGTERM reaches the process.
CMD ["node", "src/index.js"]
