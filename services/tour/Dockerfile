# Build context = repo root (xem docker-compose.yml) để copy được ./shared.
FROM node:20-alpine
WORKDIR /app

# Prisma trên Alpine cần OpenSSL để engine chạy được (nếu không: "failed to detect libssl").
RUN apk add --no-cache openssl

# Cần cả devDependencies (prisma CLI) để generate Prisma Client.
COPY services/tour/package*.json ./
RUN npm install

COPY services/tour/src ./src
COPY services/tour/prisma ./prisma
COPY shared ./shared
# Monorepo: cài deps riêng của shared (jsonwebtoken, amqplib, zod) vào ảnh.
RUN npm install --omit=dev --prefix ./shared

# Sinh Prisma Client từ schema (bắt buộc trước khi chạy).
RUN npx prisma generate

EXPOSE 3002
CMD ["npm", "start"]
