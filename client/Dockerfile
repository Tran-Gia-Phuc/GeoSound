# React PWA production image: Vite static build served by nginx (non-root, port 8080).
# Dev image with the Vite dev server: Dockerfile.dev (used by docker-compose.yml).
# Deployment plan: docs/02-design/deployment-plan.md, task 0.1.

FROM node:20-alpine AS build
WORKDIR /app

# The repo has no lockfile yet: switch to `npm ci` once client/package-lock.json is committed.
COPY package.json ./
RUN npm install --no-audit --no-fund --loglevel=error

COPY . .
# Empty = same-origin '/api' (the Ingress routes /api to the gateway).
ARG VITE_API_BASE_URL=
RUN VITE_API_BASE_URL="$VITE_API_BASE_URL" npm run build

# alpine-slim: about 20 MB; the modules it leaves out (njs, image filter, ...) are not used here.
FROM nginxinc/nginx-unprivileged:1.30-alpine-slim
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
