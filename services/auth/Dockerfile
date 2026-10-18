# Build context = repo root (xem docker-compose.yml) để copy được ./shared.
FROM node:20-alpine
WORKDIR /app

COPY services/auth/package*.json ./
RUN npm install --omit=dev

COPY services/auth/src ./src
COPY services/auth/prisma ./prisma
COPY shared ./shared

EXPOSE 3001
CMD ["npm", "start"]
