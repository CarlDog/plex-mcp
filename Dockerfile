# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
RUN addgroup -S plexmcp && adduser -S plexmcp -G plexmcp
COPY --from=build --chown=plexmcp:plexmcp /app/node_modules ./node_modules
COPY --from=build --chown=plexmcp:plexmcp /app/dist ./dist
COPY --from=build --chown=plexmcp:plexmcp /app/package.json ./package.json
USER plexmcp
ENTRYPOINT ["node", "dist/index.js"]
