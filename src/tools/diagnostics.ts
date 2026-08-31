// Server diagnostics tools. Distinct from admin.ts (item-level metadata
// operations) — this is server-level troubleshooting.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlexClient } from "../plex.js";
import { SAFE_WRITE_ANNOTATIONS, asText, withLogging } from "./helpers.js";

export function registerDiagnosticsTools(
  server: McpServer,
  plex: PlexClient,
): void {
  server.registerTool(
    "plex_download_logs",
    {
      title: "Download Plex Server Logs",
      description:
        "Fetch Plex Media Server's diagnostic ZIP through GET /diagnostics/logs and WRITE it under MCP_LOG_SAVE_DIR. If Plex returns 5xx or the transport fails, fall back to a capped read-only copy of Plex Media Server.log from MCP_PLEX_LOG_SOURCE_DIR. Returns path, byte count, MIME type, source, and a non-sensitive fallback reason - never log content inline. Authentication and other client errors do not trigger fallback. `filename` must be a safe basename; a filesystem fallback derives a .fallback.log name when a non-.log filename was requested.",
      inputSchema: {
        filename: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Safe output basename under MCP_LOG_SAVE_DIR. API success uses it as given; filesystem fallback preserves .log names or derives '<name>.fallback.log'.",
          ),
      },
      annotations: SAFE_WRITE_ANNOTATIONS,
    },
    withLogging("plex_download_logs", async ({ filename }) => {
      const result = await plex.downloadLogs({ filename });
      return asText(result);
    }),
  );
}
