# Build context = repo root (xem docker-compose.yml) để copy được ./shared.
FROM node:20-alpine
WORKDIR /app

COPY services/tour/package*.json ./
RUN npm install --omit=dev

COPY services/tour/src ./src
COPY services/tour/prisma ./prisma
COPY shared ./shared

EXPOSE 3002
CMD ["npm", "start"]
