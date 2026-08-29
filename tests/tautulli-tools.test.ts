import { describe, expect, test, vi } from "vitest";
import { CaptureServer } from "./_test_utils.js";
import { registerTautulliTools } from "../src/tools/tautulli.js";

function setup(overrides: Record<string, unknown> = {}) {
  const client = {
    checkStatus: vi.fn(async () => ({
      state: "disabled",
      configured: false,
      apiKeyConfigured: false,
      missingConfig: [],
      connectivity: null,
    })),
    getActivity: vi.fn(async () => ({ streamCount: 0, sessions: [] })),
    getHistory: vi.fn(async () => ({
      offset: 0,
      limit: 50,
      total: 0,
      filteredTotal: 0,
      items: [],
    })),
    getLibraryWatchTimeStats: vi.fn(async () => ({
      sectionId: "2",
      periods: [],
    })),
    ...overrides,
  };
  const server = new CaptureServer();
  registerTautulliTools(server as never, client as never);
  return { server, client };
}

async function call(server: CaptureServer, name: string, args = {}) {
  const tool = server.tools.find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  return tool!.handler(args) as Promise<{
    content: Array<{ type: string; text: string }>;
  }>;
}

describe("Tautulli tool wiring", () => {
  test("registers the four accepted read-only plex_tautulli tools", () => {
    const { server } = setup();
    expect(server.tools.map((tool) => tool.name)).toEqual([
      "plex_tautulli_status",
      "plex_tautulli_activity",
      "plex_tautulli_history",
      "plex_tautulli_watch_time",
    ]);
    expect(
      server.tools.every(
        (tool) => tool.config.annotations?.readOnlyHint === true,
      ),
    ).toBe(true);
  });

  test("maps history arguments and rejects ambiguous user filters", async () => {
    const { server, client } = setup();
    await call(server, "plex_tautulli_history", {
      offset: 1,
      limit: 2,
      user_id: 42,
      rating_key: "7",
      media_type: "movie",
      start_date: "2026-08-29",
    });
    expect(client.getHistory).toHaveBeenCalledWith({
      offset: 1,
      limit: 2,
      user: undefined,
      userId: 42,
      ratingKey: "7",
      mediaType: "movie",
      startDate: "2026-08-29",
    });
    await expect(
      call(server, "plex_tautulli_history", { user: "Viewer", user_id: 42 }),
    ).rejects.toThrow(/not both/);
  });

  test("uses the accepted watch-time defaults", async () => {
    const { server, client } = setup();
    await call(server, "plex_tautulli_watch_time", { section_id: "2" });
    expect(client.getLibraryWatchTimeStats).toHaveBeenCalledWith(
      "2",
      [1, 7, 30, 0],
    );
  });
});
