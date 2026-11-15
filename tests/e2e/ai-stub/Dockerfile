# AI stub for the moderation e2e test (task #AI-40). No dependencies, no LLM.
FROM node:20-alpine
WORKDIR /app
COPY server.mjs ./
ENV PORT=3004
EXPOSE 3004
CMD ["node", "server.mjs"]
