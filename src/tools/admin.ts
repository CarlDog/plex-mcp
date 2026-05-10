// Server admin tools: metadata refresh and matching. These mutate item
// metadata bindings on the server. The typical fix-an-unmatched-item
// flow is: plex_get_matches → pick the right SearchResult → plex_apply_match.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlexClient } from "../plex.js";
import { asText, withLogging } from "./helpers.js";

export function registerAdminTools(server: McpServer, plex: PlexClient): void {
  server.registerTool(
    "plex_refresh_metadata",
    {
      title: "Refresh Plex Item Metadata",
      description:
        "Tell Plex to re-pull metadata for an item from its currently-bound agent (TMDB / TVDB / etc.). Useful when poster/summary is stale, or after applying a new match. Pass force=true to bypass the agent's cache and do a deep refresh.",
      inputSchema: {
        rating_key: z
          .string()
          .describe("The Plex rating key of the item to refresh"),
        force: z
          .boolean()
          .optional()
          .describe(
            "If true, bypass agent cache for a deep refresh (slower, more server load).",
          ),
      },
    },
    withLogging("plex_refresh_metadata", async ({ rating_key, force }) => {
      await plex.refreshMetadata(rating_key, { force });
      return asText({ refreshed: rating_key, force: !!force });
    }),
  );

  server.registerTool(
    "plex_get_matches",
    {
      title: "Get Plex Match Candidates",
      description:
        "List candidate metadata matches Plex's agent considers for an item — the same list you'd see in 'Fix Match' in the Plex UI. Read-only. Pass title/year to override the auto-search terms when the filename-derived title isn't matching. Returns SearchResult entries with { name, year, guid, score, summary }.",
      inputSchema: {
        rating_key: z.string().describe("The Plex rating key of the item"),
        agent: z
          .string()
          .optional()
          .describe(
            "Override agent (e.g. 'tv.plex.agents.movie'). Defaults to the library's configured agent.",
          ),
        language: z.string().optional().describe("Language code (e.g. 'en')."),
        title: z
          .string()
          .optional()
          .describe("Override the title to search for."),
        year: z
          .number()
          .int()
          .optional()
          .describe("Override the year to search for."),
      },
    },
    withLogging(
      "plex_get_matches",
      async ({ rating_key, agent, language, title, year }) =>
        asText(
          await plex.getMatches(rating_key, { agent, language, title, year }),
        ),
    ),
  );

  server.registerTool(
    "plex_apply_match",
    {
      title: "Apply Plex Match",
      description:
        "Apply a specific metadata match to an item, overwriting its current agent binding. `guid` and `name` come from a plex_get_matches SearchResult. Mutates server state and is NOT cleanly reversible — re-applying a different match overwrites again, but the original 'agents.none' (no match) state cannot be restored without an unmatch operation (not exposed yet). Confirm intent before calling.",
      inputSchema: {
        rating_key: z
          .string()
          .describe("The Plex rating key of the item to match"),
        guid: z
          .string()
          .describe(
            "The Plex GUID of the chosen match (from plex_get_matches SearchResult.guid).",
          ),
        name: z
          .string()
          .describe(
            "The matched item's name (from plex_get_matches SearchResult.name). Required by Plex.",
          ),
      },
    },
    withLogging("plex_apply_match", async ({ rating_key, guid, name }) => {
      await plex.applyMatch(rating_key, guid, name);
      return asText({ matched: rating_key, guid, name });
    }),
  );
}
