#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { createServer as createHttpsServer } from "node:https";
import express, { type Request, type Response } from "express";
import { config } from "./config.js";
import { log } from "./log.js";
import { PlexClient } from "./plex.js";
import { resolveTlsCredentials } from "./tls.js";
import { registerTools } from "./tools/index.js";
import { SERVER_VERSION } from "./version.js";

const plex = new PlexClient({ url: config.plexUrl, token: config.plexToken });

const INSTRUCTIONS = `MCP server for Plex Media Server. Lets you search libraries, browse recently-added / on-deck / now-playing, fetch full metadata, manage playlists, and mark items watched/unwatched.

Idioms:
- Every item has a ratingKey (string). Same ID space across movies, shows, episodes, music. Get one from a search/list call, then drill into it with plex_get_item or plex_get_children.
- plex_search searches across all libraries; plex_browse is section-scoped — call plex_list_libraries first to get section IDs.
- plex_history is server-wide watch history; plex_now_playing is current streaming sessions only.
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
  registerTools(server, plex);
  return server;
}

const {
  port,
  allowedHosts: MCP_ALLOWED_HOSTS,
  allowedOrigins: MCP_ALLOWED_ORIGINS,
  sessionIdleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
} = config;

if (port) {
  // HTTP transport (long-lived server, e.g. for Portainer/Compose deployment).
  const app = express();
  app.use(express.json());

  const transports: Record<string, StreamableHTTPServerTransport> = {};
  const sessionLastActivity: Record<string, number> = {};

  function checkHostAndOrigin(
    req: Request,
    res: Response,
    next: () => void,
  ): void {
    const host = req.headers.host;
    if (!host || !MCP_ALLOWED_HOSTS.includes(host)) {
      log.warn("transport", "rejected: disallowed Host header", { host });
      res.status(421).json({ error: "Invalid Host header" });
      return;
    }
    const origin = req.headers.origin;
    if (origin && !MCP_ALLOWED_ORIGINS.includes(origin)) {
      log.warn("transport", "rejected: disallowed Origin header", { origin });
      res.status(403).json({ error: "Invalid Origin header" });
      return;
    }
    next();
  }

  app.all("/mcp", checkHostAndOrigin, async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
        sessionLastActivity[sessionId] = Date.now();
      } else if (
        !sessionId &&
        req.method === "POST" &&
        isInitializeRequest(req.body)
      ) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports[id] = transport;
            sessionLastActivity[id] = Date.now();
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) {
            delete transports[transport.sessionId];
            delete sessionLastActivity[transport.sessionId];
          }
        };
        const server = createServer();
        await server.connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message:
              "Bad Request: missing or unknown session, or non-initialize POST",
          },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error("transport", "MCP request error", {
        msg: (err as Error).message,
      });
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Sweep idle sessions. Interval is the lesser of the timeout itself and 5
  // minutes, so a short custom timeout doesn't wait a full default cycle to
  // take effect. Unref'd so it never keeps the process alive on its own.
  const sweepIntervalMs = Math.min(SESSION_IDLE_TIMEOUT_MS, 5 * 60_000);
  setInterval(() => {
    const now = Date.now();
    for (const [id, lastActivity] of Object.entries(sessionLastActivity)) {
      if (now - lastActivity <= SESSION_IDLE_TIMEOUT_MS) continue;
      log.info("transport", "evicting idle session", {
        sessionId: id,
        idleMs: now - lastActivity,
      });
      const transport = transports[id];
      delete transports[id];
      delete sessionLastActivity[id];
      transport?.close().catch((err: unknown) => {
        log.error("transport", "error closing idle session", {
          sessionId: id,
          msg: (err as Error).message,
        });
      });
    }
  }, sweepIntervalMs).unref();

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
