// REGRESSION TEST for MCP-P06: irreversible tools must refuse to act
// unless confirm_title/confirm_into_title matches the resolved target's
// actual current title. A confirm:true flag alone is advisory (an
// autonomous agent can always self-supply it) — this can't be, since a
// transposed id resolves to a *different* item whose real title won't
// match what the caller expected.
//
// Wiring tests, not just a unit test of the helper: each case invokes the
// actual registered tool handler against a stubbed PlexClient and asserts
// the destructive PlexClient method was never called on mismatch. A test
// that only exercised assertNameMatches() in isolation could pass even if
// a tool forgot to call it before the real mutation.

import { describe, expect, test, vi } from "vitest";
import type { PlexClient } from "../src/plex.js";
import { registerTools } from "../src/tools/index.js";
import { CaptureServer, type CapturedTool } from "./_test_utils.js";

function registerAndFind(plex: PlexClient, toolName: string): CapturedTool {
  const server = new CaptureServer();
  registerTools(server as never, plex);
  const tool = server.tools.find((t) => t.name === toolName);
  if (!tool) throw new Error(`tool not registered: ${toolName}`);
  return tool;
}

describe("destructive-tool name confirmation (MCP-P06)", () => {
  test("plex_delete_playlist refuses on title mismatch, never calls deletePlaylist", async () => {
    const deletePlaylist = vi.fn();
    const listPlaylists = vi
      .fn()
      .mockResolvedValue([{ ratingKey: "100", title: "Real Playlist" }]);
    const plex = { listPlaylists, deletePlaylist } as unknown as PlexClient;
    const tool = registerAndFind(plex, "plex_delete_playlist");

    await expect(
      tool.handler({ playlist_id: "100", confirm_title: "Wrong Title" }),
    ).rejects.toThrow(/does not match/);
    expect(deletePlaylist).not.toHaveBeenCalled();
  });

  test("plex_delete_playlist proceeds when confirm_title matches", async () => {
    const deletePlaylist = vi.fn().mockResolvedValue(undefined);
    const listPlaylists = vi
      .fn()
      .mockResolvedValue([{ ratingKey: "100", title: "Real Playlist" }]);
    const plex = { listPlaylists, deletePlaylist } as unknown as PlexClient;
    const tool = registerAndFind(plex, "plex_delete_playlist");

    await tool.handler({ playlist_id: "100", confirm_title: "Real Playlist" });
    expect(deletePlaylist).toHaveBeenCalledWith("100");
  });

  test("plex_split_item refuses on title mismatch, never calls splitItem", async () => {
    const splitItem = vi.fn();
    const getItem = vi.fn().mockResolvedValue({ title: "Real Item" });
    const plex = { getItem, splitItem } as unknown as PlexClient;
    const tool = registerAndFind(plex, "plex_split_item");

    await expect(
      tool.handler({ rating_key: "200", confirm_title: "Wrong Item" }),
    ).rejects.toThrow(/does not match/);
    expect(splitItem).not.toHaveBeenCalled();
  });

  test("plex_split_item refuses when the target can't be resolved at all", async () => {
    const splitItem = vi.fn();
    const getItem = vi.fn().mockResolvedValue(undefined);
    const plex = { getItem, splitItem } as unknown as PlexClient;
    const tool = registerAndFind(plex, "plex_split_item");

    await expect(
      tool.handler({ rating_key: "999", confirm_title: "Anything" }),
    ).rejects.toThrow(/could not resolve/);
    expect(splitItem).not.toHaveBeenCalled();
  });

  test("plex_split_item proceeds when confirm_title matches", async () => {
    const splitItem = vi.fn().mockResolvedValue(undefined);
    const getItem = vi.fn().mockResolvedValue({ title: "Real Item" });
    const plex = { getItem, splitItem } as unknown as PlexClient;
    const tool = registerAndFind(plex, "plex_split_item");

    await tool.handler({ rating_key: "200", confirm_title: "Real Item" });
    expect(splitItem).toHaveBeenCalledWith("200");
  });

  test("plex_merge_items refuses on target title mismatch, never calls mergeItems", async () => {
    const mergeItems = vi.fn();
    const getItem = vi.fn().mockResolvedValue({ title: "Real Target" });
    const plex = { getItem, mergeItems } as unknown as PlexClient;
    const tool = registerAndFind(plex, "plex_merge_items");

    await expect(
      tool.handler({
        into_rating_key: "300",
        source_rating_keys: ["301"],
        confirm_into_title: "Wrong Target",
      }),
    ).rejects.toThrow(/does not match/);
    expect(mergeItems).not.toHaveBeenCalled();
  });

  test("plex_merge_items proceeds when confirm_into_title matches", async () => {
    const mergeItems = vi.fn().mockResolvedValue(undefined);
    const getItem = vi.fn().mockResolvedValue({ title: "Real Target" });
    const plex = { getItem, mergeItems } as unknown as PlexClient;
    const tool = registerAndFind(plex, "plex_merge_items");

    await tool.handler({
      into_rating_key: "300",
      source_rating_keys: ["301", "302"],
      confirm_into_title: "Real Target",
    });
    expect(mergeItems).toHaveBeenCalledWith("300", ["301", "302"]);
  });
});
