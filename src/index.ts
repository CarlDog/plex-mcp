#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express, { type Request, type Response } from "express";
import { createServer as createHttpsServer } from "node:https";
import {
  createAuthMiddleware,
  loadAuthConfig,
  protectedResourceMetadata,
} from "./auth.js";
import { config } from "./config.js";
import { log } from "./log.js";
import { mountMcpRoute } from "./mcp-route.js";
import { PlexClient } from "./plex.js";
import { TautulliClient } from "./tautulli.js";
import { resolveTlsCredentials } from "./tls.js";
import { registerTools } from "./tools/index.js";
import { SERVER_VERSION } from "./version.js";

const plex = new PlexClient({ url: config.plexUrl, token: config.plexToken });
const tautulli = new TautulliClient(config.tautulli);

const INSTRUCTIONS = `MCP server for Plex Media Server. Lets you search libraries, browse recently-added / on-deck / now-playing, fetch full metadata, manage playlists, and mark items watched/unwatched.

Idioms:
- Every item has a ratingKey (string). Same ID space across movies, shows, episodes, music. Get one from a search/list call, then drill into it with plex_get_item or plex_get_children.
- plex_search searches across all libraries; plex_browse is section-scoped — call plex_list_libraries first to get section IDs.
- plex_history is Plex's server-wide history; plex_now_playing is current Plex sessions. The optional plex_tautulli_* tools provide richer Tautulli activity/history/statistics when configured.
- Mutation tools (playlist create/delete/add/remove, mark watched/unwatched) change server state. Confirm with the user before invoking unless intent is unambiguous.

Auth: a single Plex token, scoped to one user account on the server. Operations affect that account's view.`;

function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "plex-mcp",
      version: SERVER_VERSION,
    },
    {
      instructions: INSTRUCTIONS,
    },
  );
  registerTools(server, plex, tautulli);
  return server;
}

const {
  port,
  allowedHosts: MCP_ALLOWED_HOSTS,
  allowedOrigins: MCP_ALLOWED_ORIGINS,
  sessionIdleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
  rateLimitMaxRequests: MCP_RATE_LIMIT_MAX_REQUESTS,
  authToken: MCP_AUTH_TOKEN,
} = config;

if (port) {
  // HTTP transport (long-lived server, e.g. for Portainer/Compose deployment).
  const app = express();
  app.use(express.json());

  if (MCP_AUTH_TOKEN) {
    log.info("auth", "MCP_AUTH_TOKEN set — /mcp requires a bearer token");
  } else {
    log.warn(
      "auth",
      "MCP_AUTH_TOKEN not set — /mcp accepts unauthenticated requests from " +
        "anything that passes the Host/Origin allowlist. Set it unless this " +
        "is a fully trusted network.",
    );
  }

  // OAuth 2.1 protected-resource auth (ChatGPT Apps SDK alignment, Phase
  // 2 — see docs/CHATGPT-APPS-SDK.md). Opt-in: MCP_OAUTH_ISSUER unset
  // means authConfig is null and the server behaves exactly as before.
  const authConfig = loadAuthConfig();
  if (authConfig) {
    log.info("auth", "OAuth enforcement enabled", {
      issuer: authConfig.issuer,
      required_scopes: authConfig.requiredScopes,
    });
    // Public per RFC 9728 — no auth on this route itself. Only mounted
    // when auth is actually configured; with no issuer there's nothing
    // accurate to report here.
    app.get(
      "/.well-known/oauth-protected-resource",
      (_req: Request, res: Response) => {
        res.json(protectedResourceMetadata(authConfig));
      },
    );
  }

  mountMcpRoute(app, "/mcp", {
    createServer,
    allowedHosts: MCP_ALLOWED_HOSTS,
    allowedOrigins: MCP_ALLOWED_ORIGINS,
    sessionIdleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
    rateLimitMaxRequests: MCP_RATE_LIMIT_MAX_REQUESTS,
    authToken: MCP_AUTH_TOKEN,
    authMiddleware: authConfig ? createAuthMiddleware(authConfig) : undefined,
  });

  const tls = await resolveTlsCredentials();
  const transportLabel = tls ? "https" : "http";

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", transport: transportLabel, port });
  });

  if (tls) {
    createHttpsServer({ cert: tls.cert, key: tls.key }, app).listen(
      port,
      () => {
        log.info("server", "listening", { transport: "https", port });
      },
    );
  } else {
    app.listen(port, () => {
      log.info("server", "listening", { transport: "http", port });
    });
  }
} else {
  // Default: stdio transport (for direct invocation by MCP clients via `docker run -i`).
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
