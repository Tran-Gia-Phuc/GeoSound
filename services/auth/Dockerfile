# Build context = repo root (xem docker-compose.yml) để copy được ./shared.
FROM node:20-alpine
WORKDIR /app

# Cần cả devDependencies (prisma CLI) để generate client + đẩy schema.
COPY services/auth/package*.json ./
RUN npm install

COPY services/auth/src ./src
COPY services/auth/prisma ./prisma
COPY shared ./shared

# Sinh Prisma Client từ schema (bắt buộc trước khi chạy).
RUN npx prisma generate

EXPOSE 3001
# Dev: đồng bộ schema -> DB (db push) rồi khởi động. Khi có migration thật sẽ đổi sang `prisma migrate deploy`.
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm start"]
