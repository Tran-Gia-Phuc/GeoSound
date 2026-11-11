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
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
# Files stay owned by root (read-only for the app); the process runs as `node`.
USER node
EXPOSE 8080
# node directly (no npm wrapper) so SIGTERM reaches the process.
CMD ["node", "src/index.js"]
