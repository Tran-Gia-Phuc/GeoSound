# Build context = repo root (xem docker-compose.yml) để copy được ./shared.
FROM node:20-alpine
WORKDIR /app

# Prisma trên Alpine cần OpenSSL để engine chạy được (nếu không: "failed to detect libssl").
RUN apk add --no-cache openssl

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
# DDL (db push) phải qua session pooler 5432 (DATABASE_URL_DIRECT_AUTH), KHÔNG qua pgbouncer 6543.
# Runtime vẫn dùng DATABASE_URL (6543) do compose set. Nếu db push lỗi (vd schema đã có) vẫn khởi động.
CMD ["sh", "-c", "DATABASE_URL=\"${DATABASE_URL_DIRECT_AUTH:-$DATABASE_URL}\" npx prisma db push --skip-generate || echo 'db push skipped'; npm start"]
