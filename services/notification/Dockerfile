# Build context = repo root (xem docker-compose.yml) để copy được ./shared.
FROM node:20-alpine
WORKDIR /app

# Prisma on Alpine needs OpenSSL for its engine ("failed to detect libssl" otherwise).
RUN apk add --no-cache openssl

# devDependencies too (prisma CLI) to generate the Prisma Client.
COPY services/notification/package*.json ./
RUN npm install

COPY services/notification/src ./src
COPY services/notification/prisma ./prisma
COPY shared ./shared
# Monorepo: install shared's own deps (jsonwebtoken for verifyJwt, amqplib, zod).
RUN npm install --omit=dev --prefix ./shared

# Generate the Prisma Client from the schema. No `prisma db push` on start (UC16 / #270):
# the schema is pushed by hand (docs/02-design/uc16-notifications.md section 3).
RUN npx prisma generate

# UC16: HTTP :3006 (in-app notifications, gateway /api/notifications) + RabbitMQ worker.
EXPOSE 3006
CMD ["npm", "start"]
