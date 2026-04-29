// Session tools: currently-playing sessions and watch history.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlexClient } from "../plex.js";
import { asText } from "./helpers.js";

export function registerSessionsTools(
  server: McpServer,
  plex: PlexClient,
): void {
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
      asText(await plex.history({ offset, limit, sectionId: section_id })),
  );
}
