# Build context = repo root (see docker-compose.yml) so ./shared can be copied.
FROM node:20-alpine
WORKDIR /app

# Prisma engines on Alpine need OpenSSL.
RUN apk add --no-cache openssl

# Dev dependencies are needed for the prisma CLI (generate + db push).
COPY services/moderation/package*.json ./
RUN npm install

COPY services/moderation/src ./src
COPY services/moderation/prisma ./prisma
COPY shared ./shared
# Monorepo: install shared's own deps (jsonwebtoken, amqplib, zod) into the image.
RUN npm install --omit=dev --prefix ./shared

# Generate the Prisma client from the schema.
RUN npx prisma generate

EXPOSE 3003
# Dev: sync schema to the DB (db push) then start. DDL goes through the direct URL when set
# (DATABASE_URL_DIRECT_MODERATION), not pgbouncer. If db push fails the service still starts.
CMD ["sh", "-c", "DATABASE_URL=\"${DATABASE_URL_DIRECT_MODERATION:-$DATABASE_URL}\" npx prisma db push --skip-generate || echo 'db push skipped'; npm start"]
