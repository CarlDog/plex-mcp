#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import { PlexClient } from "./plex.js";

const PLEX_URL = process.env.PLEX_URL;
const PLEX_TOKEN = process.env.PLEX_TOKEN;

if (!PLEX_URL || !PLEX_TOKEN) {
  console.error("PLEX_URL and PLEX_TOKEN environment variables are required");
  process.exit(1);
}

const plex = new PlexClient({ url: PLEX_URL, token: PLEX_TOKEN });

const asText = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const PLEX_TYPE_CODES: Record<string, number> = {
  movie: 1,
  show: 2,
  season: 3,
  episode: 4,
  artist: 8,
  album: 9,
  track: 10,
};

function createServer(): McpServer {
  const server = new McpServer({
    name: "plex-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "plex_list_libraries",
    {
      title: "List Plex Libraries",
      description: "List all libraries (sections) on the Plex server.",
      inputSchema: {},
    },
    async () => asText(await plex.listLibraries()),
  );

  server.registerTool(
    "plex_search",
    {
      title: "Plex Search",
      description:
        "Search across all Plex libraries for movies, shows, episodes, music, etc.",
      inputSchema: { query: z.string().describe("Search query") },
    },
    async ({ query }) => asText(await plex.search(query)),
  );

  server.registerTool(
    "plex_recently_added",
    {
      title: "Plex Recently Added",
      description:
        "List recently added items, optionally filtered to a specific library section.",
      inputSchema: {
        section_id: z
          .string()
          .optional()
          .describe("Optional library section ID to filter to"),
      },
    },
    async ({ section_id }) => asText(await plex.recentlyAdded(section_id)),
  );

  server.registerTool(
    "plex_on_deck",
    {
      title: "Plex On Deck",
      description:
        'Get items "on deck" — partially watched or next-up content.',
      inputSchema: {},
    },
    async () => asText(await plex.onDeck()),
  );

  server.registerTool(
    "plex_get_item",
    {
      title: "Get Plex Item",
      description: "Get full metadata for a specific item by rating key.",
      inputSchema: {
        rating_key: z.string().describe("The Plex rating key (item ID)"),
      },
    },
    async ({ rating_key }) => asText(await plex.getItem(rating_key)),
  );

  server.registerTool(
    "plex_get_children",
    {
      title: "Get Plex Item Children",
      description:
        "Get child items of a parent: show → seasons, season → episodes, artist → albums, album → tracks. Use plex_get_item or plex_search to find the parent's rating_key first.",
      inputSchema: {
        rating_key: z
          .string()
          .describe("The Plex rating key of the parent item"),
      },
    },
    async ({ rating_key }) => asText(await plex.getChildren(rating_key)),
  );

  server.registerTool(
    "plex_now_playing",
    {
      title: "Plex Now Playing",
      description:
        "Get currently-playing sessions on the Plex server. Each session includes the item being played, the user, player device, and transcoding info.",
      inputSchema: {},
    },
    async () => asText(await plex.nowPlaying()),
  );

  server.registerTool(
    "plex_history",
    {
      title: "Plex Watch History",
      description:
        "List playback history entries, sorted most recent first. Paged like plex_browse. Optionally filter to a single library section.",
      inputSchema: {
        offset: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Pagination offset (default 0)"),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe("Page size, max 200 (default 50)"),
        section_id: z
          .string()
          .optional()
          .describe("Optional library section ID to filter to"),
      },
    },
    async ({ offset, limit, section_id }) =>
      asText(
        await plex.history({
          offset,
          limit: limit ?? 50,
          sectionId: section_id,
        }),
      ),
  );

  server.registerTool(
    "plex_browse",
    {
      title: "Browse Plex Library",
      description:
        "List items in a specific library section, paged. Use plex_list_libraries first to get section IDs. Returns { total, offset, size, items } so the assistant can page through large libraries.",
      inputSchema: {
        section_id: z
          .string()
          .describe("Library section ID (from plex_list_libraries)"),
        offset: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Pagination offset (default 0)"),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe("Page size, max 200 (default 50)"),
        type: z
          .enum([
            "movie",
            "show",
            "season",
            "episode",
            "artist",
            "album",
            "track",
          ])
          .optional()
          .describe("Filter to a specific item type"),
      },
    },
    async ({ section_id, offset, limit, type }) =>
      asText(
        await plex.browse(section_id, {
          offset,
          limit: limit ?? 50,
          type: type ? PLEX_TYPE_CODES[type] : undefined,
        }),
      ),
  );

  server.registerTool(
    "plex_mark_watched",
    {
      title: "Mark Plex Item Watched",
      description:
        "Mark a Plex item as watched (mutates server state). Reversible via plex_mark_unwatched.",
      inputSchema: {
        rating_key: z
          .string()
          .describe("The Plex rating key of the item to mark watched"),
      },
    },
    async ({ rating_key }) => {
      await plex.markWatched(rating_key);
      return asText({ marked: "watched", rating_key });
    },
  );

  server.registerTool(
    "plex_mark_unwatched",
    {
      title: "Mark Plex Item Unwatched",
      description:
        "Mark a Plex item as unwatched (mutates server state). Reversible via plex_mark_watched.",
      inputSchema: {
        rating_key: z
          .string()
          .describe("The Plex rating key of the item to mark unwatched"),
      },
    },
    async ({ rating_key }) => {
      await plex.markUnwatched(rating_key);
      return asText({ marked: "unwatched", rating_key });
    },
  );

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
