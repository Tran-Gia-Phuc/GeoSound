# Build context = repo root (xem docker-compose.yml) để copy được ./shared.
FROM node:20-alpine
WORKDIR /app

COPY services/media/package*.json ./
RUN npm install --omit=dev

COPY services/media/src ./src
COPY services/media/prisma ./prisma
COPY shared ./shared

# Worker: không EXPOSE port
CMD ["npm", "start"]
