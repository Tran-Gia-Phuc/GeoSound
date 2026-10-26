# React PWA (Vite). Dev server cho cả Tourist / Contributor / Admin.
FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5173
# Vite dev server (host:true trong vite.config.js -> 0.0.0.0).
CMD ["npm", "run", "dev"]
