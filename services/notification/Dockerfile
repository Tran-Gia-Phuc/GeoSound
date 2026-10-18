# Build context = repo root (xem docker-compose.yml) để copy được ./shared.
FROM node:20-alpine
WORKDIR /app

COPY services/notification/package*.json ./
RUN npm install --omit=dev

COPY services/notification/src ./src
COPY services/notification/prisma ./prisma
COPY shared ./shared

# Worker: không EXPOSE port
CMD ["npm", "start"]
