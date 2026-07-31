# syntax=docker/dockerfile:1.7
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:26-alpine AS runtime
WORKDIR /app
RUN addgroup -S plexmcp && adduser -S plexmcp -G plexmcp
COPY --from=build --chown=plexmcp:plexmcp /app/node_modules ./node_modules
COPY --from=build --chown=plexmcp:plexmcp /app/dist ./dist
COPY --from=build --chown=plexmcp:plexmcp /app/package.json ./package.json
USER plexmcp
# Conditional on MCP_PORT: in stdio mode (MCP_PORT unset) there is no HTTP
# server and no /health endpoint at all, so an unconditional wget probe
# would mark every `docker run -i` container permanently unhealthy. When
# MCP_PORT is set (HTTP transport), probe the real endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD sh -c '[ -z "$MCP_PORT" ] || wget -q -O- "http://localhost:$MCP_PORT/health"'
ENTRYPOINT ["node", "dist/index.js"]
