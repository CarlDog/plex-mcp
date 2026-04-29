// Hub tools: Plex's curated content rows. Two flavors —
// global (`/hubs`, returns server-wide hubs like "Continue Watching",
// "Recently Released") and per-section (`/hubs/sections/{id}`).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlexClient } from "../plex.js";
import { asText, withLogging } from "./helpers.js";

export function registerHubsTools(server: McpServer, plex: PlexClient): void {
  server.registerTool(
    "plex_hubs",
    {
      title: "Plex Global Hubs",
      description:
        "Get Plex's curated server-wide hubs (Continue Watching, Recently Released, Top Picks, etc.). Each hub has a `title`, `type`, and a list of items. Use plex_section_hubs for per-library hubs.",
      inputSchema: {},
    },
    withLogging("plex_hubs", async () => asText(await plex.hubs())),
  );

  server.registerTool(
    "plex_section_hubs",
    {
      title: "Plex Section Hubs",
      description:
        "Get Plex's curated hubs scoped to a single library section (Recently Added, Most Popular, By Genre, etc.). Use plex_list_libraries to get section IDs.",
      inputSchema: {
        section_id: z
          .string()
          .describe("Library section ID (from plex_list_libraries)"),
      },
    },
    withLogging("plex_section_hubs", async ({ section_id }) =>
      asText(await plex.sectionHubs(section_id)),
    ),
  );
}
