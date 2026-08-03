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
        "Fetch Plex Media Server's own diagnostic log bundle (GET /diagnostics/logs — the same endpoint the web UI's Settings → Help → 'Download Server Logs' button uses) and WRITE it to disk inside the container under MCP_LOG_SAVE_DIR (default /data/logs/). Returns the path, byte count, and MIME type as JSON — NOT the archive content inline (a log bundle can be tens of MB and would blow the response budget). The response is an unmodified ZIP archive covering PMS's own logs — third-party plugin logs are excluded by Plex itself, not by this tool. Use for troubleshooting real server issues (a failed scheduled recording, a scan that silently skipped files, a match that errored) that plex_refresh_metadata/plex_refresh_section alone can't explain. `filename` must be a basename (no '/', '\\\\', '..', or leading '.') — defense against directory traversal; defaults to a timestamped name if omitted.",
      inputSchema: {
        filename: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Basename to write under MCP_LOG_SAVE_DIR. No path separators or traversal sequences. Defaults to 'plex-logs-<timestamp>.zip' if omitted.",
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
