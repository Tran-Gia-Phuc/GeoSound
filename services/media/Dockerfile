# Build context = repo root (xem docker-compose.yml) để copy được ./shared.
FROM node:20-alpine
WORKDIR /app

COPY services/media/package*.json ./
RUN npm install --omit=dev

COPY services/media/src ./src
COPY services/media/prisma ./prisma
COPY shared ./shared
# Monorepo: cài deps riêng của shared (jsonwebtoken cho verifyJwt, amqplib).
RUN npm install --omit=dev --prefix ./shared

# HTTP tải ảnh/audio (POST /uploads) + phục vụ file dev (GET /files/*).
# File dev lưu ở /data/media (gắn volume để không mất khi tạo lại container).
RUN mkdir -p /data/media
EXPOSE 3005
CMD ["npm", "start"]
