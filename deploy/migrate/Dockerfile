# Migrate image (deployment plan task 2.4, issue #372): the Prisma CLI, scripts/db/migrate.sh and
# the prisma folder (schema.prisma, migrations/) of every service at /migrations/<svc>, the layout
# of the compose `migrate` service (task 0.6). The media and ai images have no Prisma CLI, so this
# one image migrates the six schemas. Run by the migrate Job of the Helm chart.
# Build context: the repo root; Dockerfile.dockerignore next to this file is the allow list.
FROM node:20-alpine
WORKDIR /app
# Same base hardening as the service images (task 1.2): npm 11, apk upgrade.
RUN npm install -g npm@11.21.2 --no-audit --no-fund --loglevel=error \
 && npm cache clean --force && rm -rf /root/.npm /tmp/* \
 && apk upgrade --no-cache \
 && apk add --no-cache openssl
COPY deploy/migrate/package.json ./
# The engines are downloaded here, at build time: the Job has no reason to reach the internet.
RUN npm install --omit=dev --no-audit --no-fund --loglevel=error \
 && npx --no-install prisma --version \
 && rm -rf node_modules/prisma/build/public \
 && npm cache clean --force && rm -rf /root/.npm /tmp/*
COPY scripts/db/migrate.sh ./migrate.sh
COPY services/auth/prisma /migrations/auth
COPY services/tour/prisma /migrations/tour
COPY services/moderation/prisma /migrations/moderation
COPY services/notification/prisma /migrations/notification
COPY services/media/prisma /migrations/media
COPY services/ai/prisma /migrations/ai
# npm writes its cache and logs under /tmp: the Job runs with a read-only root file system.
ENV NODE_ENV=production MIGRATIONS_DIR=/migrations NPM_CONFIG_CACHE=/tmp/.npm \
    NPM_CONFIG_UPDATE_NOTIFIER=false PRISMA_HIDE_UPDATE_MESSAGE=1
USER node
ENTRYPOINT ["sh", "/app/migrate.sh"]
CMD ["deploy"]
