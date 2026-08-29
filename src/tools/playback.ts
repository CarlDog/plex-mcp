// Playback / watch-state mutation tools. Reversible by design:
// mark_watched <-> mark_unwatched. Note that scrobble overwrites
// lastViewedAt on every call — see docs/PLEX-API.md.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlexClient } from "../plex.js";
import {
  SAFE_IDEMPOTENT_WRITE_ANNOTATIONS,
  SAFE_WRITE_ANNOTATIONS,
  asText,
  withLogging,
} from "./helpers.js";

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
      annotations: SAFE_WRITE_ANNOTATIONS,
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
      annotations: SAFE_WRITE_ANNOTATIONS,
    },
    withLogging("plex_mark_unwatched", async ({ rating_key }) => {
      await plex.markUnwatched(rating_key);
      return asText({ marked: "unwatched", rating_key });
    }),
  );

  server.registerTool(
    "plex_rate_item",
    {
      title: "Rate Plex Item",
      description:
        "Set a Plex item's user star rating (0-10 scale; Plex displays it out of 5 stars, e.g. 7 = 3.5 stars). Omit rating to clear it back to unrated.",
      inputSchema: {
        rating_key: z
          .string()
          .describe("The Plex rating key of the item to rate"),
        rating: z
          .number()
          .min(0)
          .max(10)
          .optional()
          .describe(
            "Rating from 0 to 10. Omit to clear the rating (back to unrated).",
          ),
      },
      annotations: SAFE_IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    withLogging("plex_rate_item", async ({ rating_key, rating }) => {
      await plex.rateItem(rating_key, rating);
      return asText({ rating_key, rating: rating ?? null });
    }),
  );

  server.registerTool(
    "plex_remove_from_continue_watching",
    {
      title: "Remove Plex Item From Continue Watching",
      description:
        "Remove an item from the Continue Watching hub without affecting its watch progress (viewOffset/lastViewedAt are untouched). The item reappears automatically the next time it's resumed. Safe to call on an item that's already off the hub — it's a no-op.",
      inputSchema: {
        rating_key: z
          .string()
          .describe(
            "The Plex rating key of the item to remove from Continue Watching",
          ),
      },
      annotations: SAFE_IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    withLogging(
      "plex_remove_from_continue_watching",
      async ({ rating_key }) => {
        await plex.removeFromContinueWatching(rating_key);
        return asText({ removed_from_continue_watching: rating_key });
      },
    ),
  );
}
