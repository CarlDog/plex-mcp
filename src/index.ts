#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PlexClient } from "./plex.js";

const PLEX_URL = process.env.PLEX_URL;
const PLEX_TOKEN = process.env.PLEX_TOKEN;

if (!PLEX_URL || !PLEX_TOKEN) {
  console.error("PLEX_URL and PLEX_TOKEN environment variables are required");
  process.exit(1);
}

const plex = new PlexClient({ url: PLEX_URL, token: PLEX_TOKEN });

const server = new McpServer({
  name: "plex-mcp",
  version: "0.1.0",
});

const asText = (data: unknown) => ({
  content: [
    { type: "text" as const, text: JSON.stringify(data, null, 2) },
  ],
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

await server.connect(new StdioServerTransport());
