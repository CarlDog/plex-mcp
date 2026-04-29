// Playlist tools: CRUD over regular Plex playlists.
//
// Smart playlists (filter-based, auto-updating) are visible via
// plex_list_playlists but the mutation tools (create/add/remove)
// only support regular playlists. Plex's API for smart playlists
// requires a different shape (filter expressions) which is out of
// scope for v0.3.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PlexClient } from "../plex.js";
import { asText } from "./helpers.js";

export function registerPlaylistsTools(
  server: McpServer,
  plex: PlexClient,
): void {
  server.registerTool(
    "plex_list_playlists",
    {
      title: "List Plex Playlists",
      description:
        "List all playlists on the Plex server. Each entry includes a `smart` field; smart playlists are filter-based and auto-updating, regular playlists are explicit lists. The mutation tools (add/remove/delete) only support regular playlists.",
      inputSchema: {},
    },
    async () => asText(await plex.listPlaylists()),
  );
}
