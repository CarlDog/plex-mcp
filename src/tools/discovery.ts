// Discovery tools: read-only library browsing, search, item lookup,
// hierarchy traversal. Everything here is a thin wrapper over a single
// Plex API call.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlexClient } from "../plex.js";
import { asText } from "./helpers.js";

const PLEX_TYPE_CODES: Record<string, number> = {
  movie: 1,
  show: 2,
  season: 3,
  episode: 4,
  artist: 8,
  album: 9,
  track: 10,
};

export function registerDiscoveryTools(
  server: McpServer,
  plex: PlexClient,
): void {
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
          limit,
          type: type ? PLEX_TYPE_CODES[type] : undefined,
        }),
      ),
  );
}
