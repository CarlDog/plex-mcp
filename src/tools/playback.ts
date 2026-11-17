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

  server.registerTool(
    "plex_set_subtitle_stream",
    {
      title: "Select Plex Subtitle Stream",
      description:
        "Select which subtitle track plays for an item (mutates server state). Pass a stream id from the item's Media[].Part[].Stream[] (plex_get_item with minimal=true lists subtitle streams with id, language, codec and hearingImpaired); the owning media part is resolved automatically and the id is verified to be a subtitle stream on this item. Pass stream_id=0 to turn subtitles off. Selection is per Plex account (the PLEX_TOKEN user) and applies to the item's playable parts. Reversible: the response includes previous_stream_id — call again with it to restore.",
      inputSchema: {
        rating_key: z
          .string()
          .describe(
            "The Plex rating key of the playable item (episode, movie, track).",
          ),
        stream_id: z
          .number()
          .int()
          .min(0)
          .describe(
            "The subtitle stream's id from Media[].Part[].Stream[], or 0 to turn subtitles off.",
          ),
        part_id: z
          .string()
          .optional()
          .describe(
            "Only needed with stream_id=0 on items with several media parts: the Media.Part id to turn subtitles off on. Defaults to the first part. With a non-zero stream_id the part is derived from the stream, and a part_id that names a different part is rejected.",
          ),
      },
      annotations: SAFE_IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    withLogging(
      "plex_set_subtitle_stream",
      async ({ rating_key, stream_id, part_id }) => {
        const result = await plex.setSubtitleStream(
          rating_key,
          stream_id,
          part_id,
        );
        return asText({
          rating_key,
          part_id: result.partId,
          selected_stream_id: result.selectedStreamId,
          previous_stream_id: result.previousStreamId,
        });
      },
    ),
  );

  server.registerTool(
    "plex_set_audio_stream",
    {
      title: "Select Plex Audio Stream",
      description:
        "Select which audio track plays for an item (mutates server state). Pass a stream id from the item's Media[].Part[].Stream[] (streamType 2 entries in the full plex_get_item response — minimal mode drops audio streams); the owning media part is resolved automatically and the id is verified to be an audio stream on this item. There is no 'off' for audio. Selection is per Plex account (the PLEX_TOKEN user). Reversible: the response includes previous_stream_id — call again with it to restore. previous_stream_id is null when no audio track was explicitly selected before (Plex was using its default); that state cannot be restored by this tool.",
      inputSchema: {
        rating_key: z
          .string()
          .describe(
            "The Plex rating key of the playable item (episode, movie, track).",
          ),
        stream_id: z
          .number()
          .int()
          .min(1)
          .describe("The audio stream's id from Media[].Part[].Stream[]."),
      },
      annotations: SAFE_IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    withLogging("plex_set_audio_stream", async ({ rating_key, stream_id }) => {
      const result = await plex.setAudioStream(rating_key, stream_id);
      return asText({
        rating_key,
        part_id: result.partId,
        selected_stream_id: result.selectedStreamId,
        // 0 means "nothing was explicitly selected", and 0 is not a valid
        // audio stream_id (no audio off), so report null rather than a
        // value the model would try to pass back.
        previous_stream_id: result.previousStreamId || null,
      });
    }),
  );
}
