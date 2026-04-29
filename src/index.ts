#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import { PlexClient } from "./plex.js";
import { registerTools } from "./tools/index.js";

const PLEX_URL = process.env.PLEX_URL;
const PLEX_TOKEN = process.env.PLEX_TOKEN;

if (!PLEX_URL || !PLEX_TOKEN) {
  console.error("PLEX_URL and PLEX_TOKEN environment variables are required");
  process.exit(1);
}

const plex = new PlexClient({ url: PLEX_URL, token: PLEX_TOKEN });

function createServer(): McpServer {
  const server = new McpServer({
    name: "plex-mcp",
    version: "0.2.0",
  });
  registerTools(server, plex);
  return server;
}

const portStr = process.env.MCP_PORT;
const port = portStr ? Number.parseInt(portStr, 10) : null;
if (portStr && (port === null || Number.isNaN(port))) {
  console.error(`Invalid MCP_PORT: ${portStr}`);
  process.exit(1);
}

if (port) {
  // HTTP transport (long-lived server, e.g. for Portainer/Compose deployment).
  const app = express();
  app.use(express.json());

  const transports: Record<string, StreamableHTTPServerTransport> = {};

  app.all("/mcp", async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (
        !sessionId &&
        req.method === "POST" &&
        isInitializeRequest(req.body)
      ) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports[id] = transport;
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) {
            delete transports[transport.sessionId];
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
      console.error("MCP request error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", transport: "http", port });
  });

  app.listen(port, () => {
    console.error(`plex-mcp HTTP transport listening on :${port}`);
  });
} else {
  // Default: stdio transport (for direct invocation by MCP clients via `docker run -i`).
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
