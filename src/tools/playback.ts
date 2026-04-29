// Playback / watch-state mutation tools. Reversible by design:
// mark_watched <-> mark_unwatched. Note that scrobble overwrites
// lastViewedAt on every call — see docs/PLEX-API.md.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlexClient } from "../plex.js";
import { asText, withLogging } from "./helpers.js";

export function registerPlaybackTools(
  server: McpServer,
  plex: PlexClient,
): void {
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
    withLogging("plex_mark_watched", async ({ rating_key }) => {
      await plex.markWatched(rating_key);
      return asText({ marked: "watched", rating_key });
    }),
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
    withLogging("plex_mark_unwatched", async ({ rating_key }) => {
      await plex.markUnwatched(rating_key);
      return asText({ marked: "unwatched", rating_key });
    }),
  );
}
