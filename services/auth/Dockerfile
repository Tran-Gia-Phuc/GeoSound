# Build context = repo root (see docker-compose.yml) so ./shared can be copied.
# Targets: `dev` (nodemon, used by docker-compose.dev.yml) and `prod` (default, last stage).
# Deployment plan: docs/02-design/deployment-plan.md, task 0.2.

FROM node:20-alpine AS base
WORKDIR /app
# Prisma's engine on Alpine needs OpenSSL ("failed to detect libssl" otherwise).
RUN apk add --no-cache openssl
COPY services/auth/package*.json ./
COPY shared/package.json ./shared/

# All dependencies (prisma CLI included) and the generated Prisma Client.
FROM base AS deps
RUN npm install --no-audit --no-fund --loglevel=error
COPY services/auth/prisma ./prisma
RUN npx prisma generate

# Dev image: keeps nodemon; docker-compose.dev.yml mounts src/ and shared/.
FROM deps AS dev
COPY services/auth/src ./src
COPY shared ./shared
EXPOSE 3001
CMD ["sh", "-c", "DATABASE_URL=\"${DATABASE_URL_DIRECT_AUTH:-$DATABASE_URL}\" npx prisma db push --skip-generate || echo 'db push skipped'; npm start"]

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
COPY services/auth/package.json ./
COPY services/auth/prisma ./prisma
COPY services/auth/src ./src
COPY shared ./shared
# Files stay owned by root (read-only for the app); the process runs as `node`.
# `prisma db push | validate` work as `node`; `prisma generate` needs `--user root`
# and network access (it downloads the query engine).
USER node
EXPOSE 3001
# Sync the schema (db push) then start. DDL goes through the session pooler 5432
# (DATABASE_URL_DIRECT_AUTH), not pgbouncer 6543; the runtime keeps DATABASE_URL from compose.
# A failed push (for example an existing schema) does not stop the start.
# `exec` so node replaces the shell and receives SIGTERM. Task 0.6 replaces db push
# with `prisma migrate deploy` in a migrate Job.
CMD ["sh", "-c", "DATABASE_URL=\"${DATABASE_URL_DIRECT_AUTH:-$DATABASE_URL}\" npx prisma db push --skip-generate || echo 'db push skipped'; exec node src/index.js"]
