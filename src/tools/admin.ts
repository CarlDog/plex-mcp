// Server admin tools: metadata refresh and matching. These mutate item
// metadata bindings on the server. The typical fix-an-unmatched-item
// flow is: plex_get_matches → pick the right SearchResult → plex_apply_match.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlexClient } from "../plex.js";
import {
  READ_ONLY_ANNOTATIONS,
  SAFE_IDEMPOTENT_WRITE_ANNOTATIONS,
  SAFE_WRITE_ANNOTATIONS,
  asText,
  withLogging,
} from "./helpers.js";

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
      annotations: SAFE_IDEMPOTENT_WRITE_ANNOTATIONS,
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
      annotations: READ_ONLY_ANNOTATIONS,
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
      annotations: SAFE_IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    withLogging("plex_apply_match", async ({ rating_key, guid, name }) => {
      await plex.applyMatch(rating_key, guid, name);
      return asText({ matched: rating_key, guid, name });
    }),
  );

  server.registerTool(
    "plex_edit_metadata",
    {
      title: "Edit Plex Item Metadata",
      description:
        "Override scalar metadata fields on an item (title, summary, year, etc.) and lock them so the next agent refresh doesn't wipe the override. The lock is essential — without it, plex_refresh_metadata or any rescan reverts your changes. Use when the upstream TMDB/TVDB title is technically right but visually awkward (year-doubling, missing punctuation, etc.) or when an auto-extracted scalar is wrong. Mutating; reversibility is partial (set again to a different value, or call with lock=false to release the lock and let agent metadata reassert).",
      inputSchema: {
        rating_key: z.string().describe("The Plex rating key of the item"),
        fields: z
          .object({
            title: z.string().optional(),
            title_sort: z.string().optional(),
            summary: z.string().optional(),
            year: z.number().int().min(1880).max(2100).optional(),
            originally_available_at: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
              .optional(),
            content_rating: z.string().optional(),
            studio: z.string().optional(),
            tagline: z.string().optional(),
          })
          .refine(
            (f) => Object.values(f).some((v) => v !== undefined),
            "fields: at least one field must be provided",
          )
          .describe(
            "Map of fields to set. snake_case keys are translated to Plex's camelCase internally. At least one field is required.",
          ),
        lock: z
          .boolean()
          .optional()
          .describe(
            "If true (default), each set field gets .locked=1 so future refreshes preserve it. Set false only for transient overrides that should be re-derived from the agent on next refresh.",
          ),
      },
      annotations: SAFE_IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    withLogging("plex_edit_metadata", async ({ rating_key, fields, lock }) => {
      // Translate snake_case → camelCase for Plex's API.
      const plexFields: Record<string, string | number> = {};
      if (fields.title !== undefined) plexFields.title = fields.title;
      if (fields.title_sort !== undefined)
        plexFields.titleSort = fields.title_sort;
      if (fields.summary !== undefined) plexFields.summary = fields.summary;
      if (fields.year !== undefined) plexFields.year = fields.year;
      if (fields.originally_available_at !== undefined)
        plexFields.originallyAvailableAt = fields.originally_available_at;
      if (fields.content_rating !== undefined)
        plexFields.contentRating = fields.content_rating;
      if (fields.studio !== undefined) plexFields.studio = fields.studio;
      if (fields.tagline !== undefined) plexFields.tagline = fields.tagline;

      const effectiveLock = lock ?? true;
      await plex.editMetadata(rating_key, plexFields, effectiveLock);
      return asText({
        updated: Object.keys(plexFields),
        rating_key,
        locked: effectiveLock,
      });
    }),
  );

  server.registerTool(
    "plex_unmatch",
    {
      title: "Unmatch Plex Item",
      description:
        "Detach an item from its current agent binding, returning it to the unmatched `tv.plex.agents.none` state. After this the item will display its raw filename as the title until you re-bind it. Recovery flow: plex_get_matches → plex_apply_match → plex_refresh_metadata. Locked field values survive across unmatch. Mutating; reversed by applying a fresh match.",
      inputSchema: {
        rating_key: z
          .string()
          .describe("The Plex rating key of the item to unmatch"),
      },
      annotations: SAFE_IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    withLogging("plex_unmatch", async ({ rating_key }) => {
      await plex.unmatch(rating_key);
      return asText({ unmatched: rating_key });
    }),
  );

  server.registerTool(
    "plex_refresh_section",
    {
      title: "Refresh Plex Library Section",
      description:
        "Trigger a metadata refresh for an entire library section. The refresh runs asynchronously on Plex; this tool returns immediately. Useful after bulk filesystem changes that Plex's built-in auto-scan hasn't picked up. Default is an incremental scan; pass force=true for a deep refresh that re-evaluates every item (slow, server-load-heavy). For per-item refresh, use plex_refresh_metadata.",
      inputSchema: {
        section_id: z
          .string()
          .describe(
            "Library section ID to refresh (from plex_list_libraries).",
          ),
        force: z
          .boolean()
          .optional()
          .describe(
            "If true, deep-refresh every item in the section (slow). Default false runs an incremental scan.",
          ),
      },
      annotations: SAFE_IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    withLogging("plex_refresh_section", async ({ section_id, force }) => {
      await plex.refreshSection(section_id, { force });
      return asText({ refreshed_section: section_id, force: !!force });
    }),
  );

  server.registerTool(
    "plex_split_item",
    {
      title: "Split Plex Item",
      description:
        "Split a Plex item back into its constituent media variants as N separate items. Use when Plex auto-grouped legitimately-separate releases into one ratingKey (e.g. two distinct events sharing a similar title were merged). All-or-nothing — there is no media-level granularity. The original ratingKey is consumed; N new ratingKeys are created. Reverse via plex_merge_items if the split was wrong. Mutating; confirm intent before calling.",
      inputSchema: {
        rating_key: z
          .string()
          .describe("The Plex rating key of the item to split apart"),
      },
      annotations: SAFE_WRITE_ANNOTATIONS,
    },
    withLogging("plex_split_item", async ({ rating_key }) => {
      await plex.splitItem(rating_key);
      return asText({ split: rating_key });
    }),
  );

  server.registerTool(
    "plex_merge_items",
    {
      title: "Merge Plex Items",
      description:
        "Merge other Plex items INTO a target item. The target ratingKey, GUID, and metadata survive; sources are absorbed (their ratingKeys disappear, their Media variants become Media variants of the target). Use to clean up duplicates from differently-named release directories. Reverse via plex_split_item if the merge was wrong (but the resulting split items will have new ratingKeys, not the originals). Mutating; confirm intent before calling.",
      inputSchema: {
        into_rating_key: z
          .string()
          .describe(
            "The Plex rating key of the target item (the one that survives the merge).",
          ),
        source_rating_keys: z
          .array(z.string())
          .min(1)
          .describe(
            "List of source ratingKeys to absorb into the target. Each will disappear after the merge.",
          ),
      },
      annotations: SAFE_WRITE_ANNOTATIONS,
    },
    withLogging(
      "plex_merge_items",
      async ({ into_rating_key, source_rating_keys }) => {
        await plex.mergeItems(into_rating_key, source_rating_keys);
        return asText({
          merged_into: into_rating_key,
          sources: source_rating_keys,
        });
      },
    ),
  );
}
