// Playlist tools: CRUD over regular Plex playlists.
//
// Smart playlists (filter-based, auto-updating) are visible via
// plex_list_playlists but the mutation tools (create/add/remove)
// only support regular playlists. Plex's API for smart playlists
// requires a different shape (filter expressions) which is out of
// scope for v0.3.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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

  server.registerTool(
    "plex_get_playlist_items",
    {
      title: "Get Plex Playlist Items",
      description:
        "List the items in a playlist. Each item includes a `playlistItemID` (different from `ratingKey`) which is what plex_remove_from_playlist requires.",
      inputSchema: {
        playlist_id: z.string().describe("Playlist ratingKey"),
      },
    },
    async ({ playlist_id }) => asText(await plex.getPlaylistItems(playlist_id)),
  );

  server.registerTool(
    "plex_create_playlist",
    {
      title: "Create Plex Playlist",
      description:
        "Create a new regular playlist seeded with one item. Plex's POST /playlists requires at least one initial item — to grow the playlist, call plex_add_to_playlist with more items afterward. Smart playlists are not supported by this tool.",
      inputSchema: {
        title: z.string().describe("Playlist title"),
        type: z
          .enum(["video", "audio", "photo"])
          .describe("Playlist content type"),
        rating_key: z
          .string()
          .describe("ratingKey of the seed item (must match `type`)"),
      },
    },
    async ({ title, type, rating_key }) =>
      asText(
        await plex.createPlaylist({
          title,
          type,
          ratingKey: rating_key,
        }),
      ),
  );

  server.registerTool(
    "plex_add_to_playlist",
    {
      title: "Add Item to Plex Playlist",
      description:
        "Append an item to a regular playlist. Smart playlists reject this. Use plex_get_playlist_items afterward to see the new playlistItemID assigned by Plex.",
      inputSchema: {
        playlist_id: z.string().describe("Playlist ratingKey"),
        rating_key: z.string().describe("ratingKey of the item to append"),
      },
    },
    async ({ playlist_id, rating_key }) => {
      await plex.addToPlaylist(playlist_id, rating_key);
      return asText({ added: rating_key, playlist_id });
    },
  );

  server.registerTool(
    "plex_remove_from_playlist",
    {
      title: "Remove Item from Plex Playlist",
      description:
        "Remove a single item from a regular playlist. Note: takes `playlist_item_id` (the per-playlist instance ID, from plex_get_playlist_items), NOT the underlying media's `rating_key`. The same item can appear in many playlists with different playlistItemIDs.",
      inputSchema: {
        playlist_id: z.string().describe("Playlist ratingKey"),
        playlist_item_id: z
          .string()
          .describe(
            "playlistItemID from plex_get_playlist_items (NOT ratingKey)",
          ),
      },
    },
    async ({ playlist_id, playlist_item_id }) => {
      await plex.removeFromPlaylist(playlist_id, playlist_item_id);
      return asText({
        removed: playlist_item_id,
        playlist_id,
      });
    },
  );

  server.registerTool(
    "plex_delete_playlist",
    {
      title: "Delete Plex Playlist",
      description:
        "Delete a playlist (mutates server state, NOT REVERSIBLE without recreating). Only deletes the playlist metadata — the underlying media files are not touched. Plex offers no API for deleting media via this server.",
      inputSchema: {
        playlist_id: z.string().describe("Playlist ratingKey to delete"),
      },
    },
    async ({ playlist_id }) => {
      await plex.deletePlaylist(playlist_id);
      return asText({ deleted: playlist_id });
    },
  );
}
