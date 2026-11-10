# Build context = repo root (see docker-compose.yml) so ./shared can be copied.
# Targets: `dev` (nodemon, used by docker-compose.dev.yml) and `prod` (default, last stage).
# Deployment plan: docs/02-design/deployment-plan.md, task 0.2.
# No `prisma db push` on start (UC16 / #270): the schema is pushed by hand
# (docs/02-design/uc16-notifications.md section 3).

FROM node:20-alpine AS base
WORKDIR /app
# Prisma's engine on Alpine needs OpenSSL ("failed to detect libssl" otherwise).
RUN apk add --no-cache openssl
COPY services/notification/package*.json ./
COPY shared/package.json ./shared/

# All dependencies (prisma CLI included) and the generated Prisma Client.
FROM base AS deps
RUN npm install --no-audit --no-fund --loglevel=error
# Monorepo: shared has its own dependencies (jsonwebtoken, amqplib, zod).
RUN npm install --omit=dev --no-audit --no-fund --loglevel=error --prefix ./shared
COPY services/notification/prisma ./prisma
RUN npx prisma generate

# Dev image: keeps nodemon; docker-compose.dev.yml mounts src/ and shared/.
FROM deps AS dev
COPY services/notification/src ./src
COPY shared ./shared
EXPOSE 3006
CMD ["npm", "start"]

# Runtime dependencies. npm also installs the prisma CLI as a peer of @prisma/client: it stays,
# because the team runs `npx prisma db push | validate | generate` in these containers and the
# migrate Job (task 0.6) will too. Prisma Studio's web assets are not needed. The stub client
# from the install is dropped: the prod stage copies the generated one from `deps`.
FROM base AS prod-deps
RUN npm install --omit=dev --no-audit --no-fund --loglevel=error \
 && test -x node_modules/.bin/prisma \
 && rm -rf node_modules/.prisma node_modules/prisma/build/public

FROM node:20-alpine AS prod
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY services/notification/package.json ./
COPY services/notification/prisma ./prisma
COPY services/notification/src ./src
COPY shared ./shared
# Files stay owned by root (read-only for the app); the process runs as `node`.
# `prisma db push | validate` work as `node`; `prisma generate` needs `--user root`
# and network access (it downloads the query engine).
USER node
EXPOSE 3006
# node directly (no npm wrapper) so SIGTERM reaches the process.
CMD ["node", "src/index.js"]
