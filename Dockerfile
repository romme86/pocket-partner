FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY client ./client
COPY public ./public
COPY server ./server
COPY scripts/build-offline.mjs ./scripts/build-offline.mjs
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=4174 DATA_DIR=/app/data
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg poppler-utils ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /app/data/tmp && chown -R node:node /app/data
USER node
EXPOSE 4174
CMD ["node", "build/server/index.js"]
