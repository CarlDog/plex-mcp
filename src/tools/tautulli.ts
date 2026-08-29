import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TautulliClient } from "../tautulli.js";
import { READ_ONLY_ANNOTATIONS, asText, withLogging } from "./helpers.js";

export type TautulliToolClient = Pick<
  TautulliClient,
  "checkStatus" | "getActivity" | "getHistory" | "getLibraryWatchTimeStats"
>;

export function registerTautulliTools(
  server: McpServer,
  tautulli: TautulliToolClient,
): void {
  server.registerTool(
    "plex_tautulli_status",
    {
      title: "Tautulli Status",
      description:
        "Report whether the optional Tautulli integration is disabled, misconfigured, reachable, or unavailable. This is an on-demand diagnostic; Tautulli is never part of the server healthcheck.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withLogging("plex_tautulli_status", async () =>
      asText(await tautulli.checkStatus()),
    ),
  );

  server.registerTool(
    "plex_tautulli_activity",
    {
      title: "Tautulli Activity",
      description:
        "List normalized current Plex sessions from Tautulli. Email addresses, IP addresses, machine identifiers, and filesystem paths are intentionally omitted.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withLogging("plex_tautulli_activity", async () =>
      asText(await tautulli.getActivity()),
    ),
  );

  server.registerTool(
    "plex_tautulli_history",
    {
      title: "Tautulli Watch History",
      description:
        "List normalized Tautulli watch history with optional user, item, media-type, and exact-date filters. Network identifiers and media filesystem paths are intentionally omitted.",
      inputSchema: {
        offset: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Rows to skip"),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe("Rows to return, max 200 (default 50)"),
        user: z.string().min(1).optional().describe("Tautulli friendly name"),
        user_id: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Plex/Tautulli numeric user ID"),
        rating_key: z.string().min(1).optional(),
        media_type: z.enum(["movie", "episode", "track", "live"]).optional(),
        start_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Exact history date in YYYY-MM-DD form"),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withLogging(
      "plex_tautulli_history",
      async ({
        offset,
        limit,
        user,
        user_id,
        rating_key,
        media_type,
        start_date,
      }) => {
        if (user !== undefined && user_id !== undefined) {
          throw new Error(
            "plex_tautulli_history: pass user or user_id, not both",
          );
        }
        return asText(
          await tautulli.getHistory({
            offset,
            limit,
            user,
            userId: user_id,
            ratingKey: rating_key,
            mediaType: media_type,
            startDate: start_date,
          }),
        );
      },
    ),
  );

  server.registerTool(
    "plex_tautulli_watch_time",
    {
      title: "Tautulli Library Watch Time",
      description:
        "Return Tautulli play-count and watch-time totals for one Plex library section across requested day windows. A query_days value of 0 means all time.",
      inputSchema: {
        section_id: z.string().min(1).describe("Plex library section ID"),
        query_days: z
          .array(z.number().int().min(0).max(36500))
          .min(1)
          .max(10)
          .optional()
          .describe("Day windows (default 1,7,30,0; 0 means all time)"),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withLogging(
      "plex_tautulli_watch_time",
      async ({ section_id, query_days }) =>
        asText(
          await tautulli.getLibraryWatchTimeStats(
            section_id,
            query_days ?? [1, 7, 30, 0],
          ),
        ),
    ),
  );
}
