# Build context = repo root (xem docker-compose.yml) để copy được ./shared.
FROM node:20-alpine
WORKDIR /app

COPY services/moderation/package*.json ./
RUN npm install --omit=dev

COPY services/moderation/src ./src
COPY services/moderation/prisma ./prisma
COPY shared ./shared

EXPOSE 3003
CMD ["npm", "start"]
