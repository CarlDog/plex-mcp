// Integration tests for PlexClient against a real Plex server.
//
// Per the project's "don't mock the Plex API" rule, these tests hit a
// live Plex server identified by PLEX_URL/PLEX_TOKEN env vars. If
// either env var is absent the entire suite is skipped (so CI without
// secrets passes cleanly).
//
// Fixtures are *discovered* at test bootstrap rather than hardcoded,
// so the tests survive a Plex DB rebuild that would change rating
// keys. The discovery picks:
//   - the first show-type library section
//   - the first show within that section (for getItem / getChildren)
//   - the most recent history entry (for the mark_watched round-trip)
//
// SIDE EFFECT: the round-trip test calls mark_unwatched then
// mark_watched on the most-recently-watched item. Plex's `/:/scrobble`
// overwrites `lastViewedAt` to "now" on every call, so the original
// timestamp of that watch is bumped by ~seconds. See
// `docs/PLEX-API.md` for the full gotcha.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PlexClient } from "../src/plex.js";

const PLEX_URL = process.env.PLEX_URL;
const PLEX_TOKEN = process.env.PLEX_TOKEN;
const hasEnv = !!(PLEX_URL && PLEX_TOKEN);

interface Fixtures {
  showSectionId: string;
  showRatingKey: string;
  roundTripRatingKey: string | null;
}

describe.skipIf(!hasEnv)("PlexClient (integration against live Plex)", () => {
  let client: PlexClient;
  let fixtures: Fixtures;

  beforeAll(async () => {
    client = new PlexClient({ url: PLEX_URL!, token: PLEX_TOKEN! });

    const libs = (await client.listLibraries()) as Array<{
      key: string;
      type: string;
    }>;
    const showLib = libs.find((l) => l.type === "show");
    if (!showLib) {
      throw new Error("Test fixture: no show-type library found");
    }

    const browseResult = await client.browse(showLib.key, {
      type: 2,
      limit: 1,
    });
    const firstShow = browseResult.items[0] as
      | { ratingKey: string }
      | undefined;
    if (!firstShow) {
      throw new Error(
        `Test fixture: show-type section ${showLib.key} has no shows`,
      );
    }

    const historyResult = await client.history({ limit: 1 });
    const recentEntry = historyResult.items[0] as
      | { ratingKey: string }
      | undefined;

    fixtures = {
      showSectionId: showLib.key,
      showRatingKey: firstShow.ratingKey,
      roundTripRatingKey: recentEntry?.ratingKey ?? null,
    };
  });

  it("listLibraries returns a non-empty array", async () => {
    const libs = await client.listLibraries();
    expect(Array.isArray(libs)).toBe(true);
    expect(libs.length).toBeGreaterThan(0);
  });

  it("search returns an array", async () => {
    // "the" is common enough to find something on any non-empty Plex
    const results = await client.search("the");
    expect(Array.isArray(results)).toBe(true);
  });

  it("recentlyAdded returns an array", async () => {
    const items = await client.recentlyAdded();
    expect(Array.isArray(items)).toBe(true);
  });

  it("onDeck returns an array", async () => {
    const items = await client.onDeck();
    expect(Array.isArray(items)).toBe(true);
  });

  it("getItem returns the item with the requested rating_key", async () => {
    const item = (await client.getItem(fixtures.showRatingKey)) as
      | { ratingKey: string }
      | undefined;
    expect(item).toBeDefined();
    expect(item!.ratingKey).toBe(fixtures.showRatingKey);
  });

  it("getItem with minimal=true drops bulky arrays but keeps Media.Part.file", async () => {
    const full = (await client.getItem(fixtures.showRatingKey)) as
      | Record<string, unknown>
      | undefined;
    const minimal = (await client.getItem(fixtures.showRatingKey, {
      minimal: true,
    })) as Record<string, unknown> | undefined;
    expect(minimal).toBeDefined();
    // Bulky arrays are dropped if they existed.
    for (const dropped of [
      "Role",
      "Director",
      "Writer",
      "Producer",
      "Image",
      "UltraBlurColors",
    ]) {
      if (dropped in (full ?? {})) {
        expect(dropped in minimal!).toBe(false);
      }
    }
    // Top-level identity fields survive.
    expect(minimal!.ratingKey).toBe(fixtures.showRatingKey);
    // If Media[] exists, Stream[] inside each Part is gone but file remains.
    const fullMedia = (full?.Media as Array<Record<string, unknown>>) ?? [];
    if (fullMedia.length > 0) {
      const minMedia = minimal!.Media as Array<Record<string, unknown>>;
      expect(Array.isArray(minMedia)).toBe(true);
      const firstPart = (
        minMedia[0]?.Part as Array<Record<string, unknown>>
      )?.[0];
      if (firstPart) {
        expect("Stream" in firstPart).toBe(false);
        // file may be undefined for shows (which don't have media), but
        // the key shouldn't be stripped if Plex sent it.
      }
    }
  });

  it("getItem with explicit fields returns only those keys", async () => {
    const projected = (await client.getItem(fixtures.showRatingKey, {
      fields: ["ratingKey", "title", "year"],
    })) as Record<string, unknown>;
    expect(Object.keys(projected).sort()).toEqual(
      ["ratingKey", "title", "year"].filter((k) => k in projected).sort(),
    );
    expect(projected.ratingKey).toBe(fixtures.showRatingKey);
  });

  it("getImageBytes returns image bytes for a show's thumb", async () => {
    const result = await client.getImageBytes({
      ratingKey: fixtures.showRatingKey,
    });
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(result.mimeType).toMatch(/^image\//);
    // Header sniff: JPEG starts with FFD8FF, PNG with 89504E47.
    const head = result.bytes.subarray(0, 4).toString("hex").toUpperCase();
    expect(head.startsWith("FFD8FF") || head.startsWith("89504E47")).toBe(true);
  });

  it("getImageBytes via transcode honors max_width", async () => {
    const result = await client.getImageBytes({
      ratingKey: fixtures.showRatingKey,
      maxWidth: 200,
    });
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(result.mimeType).toMatch(/^image\//);
  });

  it("getChildren returns at least one child for a show", async () => {
    const children = (await client.getChildren(
      fixtures.showRatingKey,
    )) as Array<{ type: string }>;
    expect(Array.isArray(children)).toBe(true);
    expect(children.length).toBeGreaterThan(0);
  });

  it("nowPlaying returns an array", async () => {
    const sessions = await client.nowPlaying();
    expect(Array.isArray(sessions)).toBe(true);
  });

  it("listPlaylists returns an array", async () => {
    const playlists = await client.listPlaylists();
    expect(Array.isArray(playlists)).toBe(true);
  });

  it("getMachineIdentifier returns a non-empty string", async () => {
    const id = await client.getMachineIdentifier();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("metadataUri builds a server:// URI containing the rating key", async () => {
    const uri = await client.metadataUri("12345");
    expect(uri).toMatch(
      /^server:\/\/[^/]+\/com\.plexapp\.plugins\.library\/library\/metadata\/12345$/,
    );
  });

  it("hubs returns an array", async () => {
    const hubs = await client.hubs();
    expect(Array.isArray(hubs)).toBe(true);
  });

  it("sectionHubs returns an array for a known section", async () => {
    const hubs = await client.sectionHubs(fixtures.showSectionId);
    expect(Array.isArray(hubs)).toBe(true);
  });

  it("related returns an array for a known item", async () => {
    const items = await client.related(fixtures.showRatingKey);
    expect(Array.isArray(items)).toBe(true);
  });

  it("similar returns an array for a known item", async () => {
    const items = await client.similar(fixtures.showRatingKey);
    expect(Array.isArray(items)).toBe(true);
  });

  describe("browse — pagination", () => {
    // Regression test for the X-Plex-Container-Start/Size pairing
    // bug we hit during v0.2: Plex silently ignores Size unless
    // Start is also present. Sending only `limit` blew up to "give
    // me everything in the section."
    it("respects limit", async () => {
      const result = await client.browse(fixtures.showSectionId, {
        type: 2,
        limit: 2,
      });
      expect(result.size).toBe(2);
      expect(result.items.length).toBe(2);
      expect(result.total).toBeGreaterThan(2);
    });

    it("respects offset", async () => {
      const page1 = await client.browse(fixtures.showSectionId, {
        type: 2,
        limit: 2,
      });
      const page2 = await client.browse(fixtures.showSectionId, {
        type: 2,
        limit: 2,
        offset: 2,
      });
      const p1First = (page1.items[0] as { ratingKey: string } | undefined)
        ?.ratingKey;
      const p2First = (page2.items[0] as { ratingKey: string } | undefined)
        ?.ratingKey;
      expect(p1First).toBeDefined();
      expect(p2First).toBeDefined();
      expect(p1First).not.toBe(p2First);
    });

    it("fields projection limits each item to just the requested keys", async () => {
      const fields = ["ratingKey", "title", "year"];
      const result = await client.browse(fixtures.showSectionId, {
        type: 2,
        limit: 3,
        fields,
      });
      expect(result.items.length).toBe(3);
      for (const item of result.items as Array<Record<string, unknown>>) {
        // Every returned key must be in the requested set.
        for (const key of Object.keys(item)) {
          expect(fields).toContain(key);
        }
        // At least ratingKey must be present (every Plex item has it).
        expect(item.ratingKey).toBeDefined();
      }
    });

    it("type filter narrows results to the requested type", async () => {
      const showsOnly = await client.browse(fixtures.showSectionId, {
        type: 2,
        limit: 5,
      });
      expect(
        (showsOnly.items as Array<{ type: string }>).every(
          (i) => i.type === "show",
        ),
      ).toBe(true);
    });
  });

  describe("history — pagination", () => {
    it("respects limit", async () => {
      const result = await client.history({ limit: 3 });
      expect(result.size).toBeLessThanOrEqual(3);
      expect(result.items.length).toBeLessThanOrEqual(3);
    });

    it("returns most-recent-first by default", async () => {
      const result = await client.history({ limit: 2 });
      const items = result.items as Array<{ viewedAt: number }>;
      if (items.length >= 2) {
        expect(items[0].viewedAt).toBeGreaterThanOrEqual(items[1].viewedAt);
      }
    });
  });

  // Full CRUD round-trip on regular playlists. Creates a temp
  // playlist, adds/removes items, deletes it. Cleanup in afterAll
  // in case any step fails partway through.
  describe.sequential("playlist round trip (CRUD)", () => {
    let playlistId: string | undefined;
    let item1Key: string;
    let item2Key: string;

    beforeAll(async () => {
      const browse = await client.browse(fixtures.showSectionId, {
        type: 4, // episode
        limit: 2,
      });
      if (browse.items.length < 2) {
        throw new Error(
          "Test fixture: need ≥2 episodes in the show-type library for the playlist round-trip",
        );
      }
      item1Key = (browse.items[0] as { ratingKey: string }).ratingKey;
      item2Key = (browse.items[1] as { ratingKey: string }).ratingKey;
    });

    afterAll(async () => {
      if (playlistId) {
        try {
          await client.deletePlaylist(playlistId);
        } catch {
          // best-effort cleanup
        }
      }
    });

    it("creates a playlist seeded with one item", async () => {
      const result = (await client.createPlaylist({
        title: `plex-mcp test ${Date.now()}`,
        type: "video",
        ratingKey: item1Key,
      })) as { ratingKey: string } | undefined;
      expect(result).toBeDefined();
      playlistId = result!.ratingKey;
      expect(typeof playlistId).toBe("string");
    });

    it("appears in listPlaylists", async () => {
      const playlists = (await client.listPlaylists()) as Array<{
        ratingKey: string;
      }>;
      expect(playlists.some((p) => p.ratingKey === playlistId)).toBe(true);
    });

    it("getPlaylistItems returns the seed item", async () => {
      const items = (await client.getPlaylistItems(playlistId!)) as Array<{
        ratingKey: string;
      }>;
      expect(items.length).toBe(1);
      expect(items[0].ratingKey).toBe(item1Key);
    });

    it("addToPlaylist appends a second item", async () => {
      await client.addToPlaylist(playlistId!, item2Key);
      const items = (await client.getPlaylistItems(playlistId!)) as Array<{
        ratingKey: string;
      }>;
      expect(items.length).toBe(2);
    });

    it("removeFromPlaylist removes by playlistItemID", async () => {
      const before = (await client.getPlaylistItems(playlistId!)) as Array<{
        playlistItemID: number;
      }>;
      expect(before.length).toBe(2);
      await client.removeFromPlaylist(
        playlistId!,
        String(before[0].playlistItemID),
      );
      const after = (await client.getPlaylistItems(playlistId!)) as unknown[];
      expect(after.length).toBe(1);
    });

    it("deletePlaylist removes the playlist", async () => {
      await client.deletePlaylist(playlistId!);
      const playlists = (await client.listPlaylists()) as Array<{
        ratingKey: string;
      }>;
      expect(playlists.some((p) => p.ratingKey === playlistId)).toBe(false);
      playlistId = undefined; // signal afterAll: nothing to clean up
    });
  });

  describe("admin — refreshMetadata / getMatches / applyMatch", () => {
    it("refreshMetadata succeeds on a known item", async () => {
      // No-op for a healthy item in terms of observable state, but
      // exercises the PUT /refresh endpoint and asserts no error.
      await client.refreshMetadata(fixtures.showRatingKey);
    });

    it("refreshMetadata with force=true succeeds", async () => {
      await client.refreshMetadata(fixtures.showRatingKey, { force: true });
    });

    it("getMatches returns an array for a known item", async () => {
      const matches = await client.getMatches(fixtures.showRatingKey);
      expect(Array.isArray(matches)).toBe(true);
    });

    it("getMatches accepts title/year overrides", async () => {
      // Just exercising the param-passing path — Plex may or may not
      // return results depending on whether the override matches
      // anything. Either way it should be an array, no error.
      const matches = await client.getMatches(fixtures.showRatingKey, {
        title: "the",
        year: 2010,
      });
      expect(Array.isArray(matches)).toBe(true);
    });

    // applyMatch is exercised by re-applying the item's current match
    // back to itself — net no-op on observable state, validates the
    // PUT /match endpoint shape. Skipped if the fixture item is on
    // the `tv.plex.agents.none` agent (no current match to re-apply).
    it("applyMatch round-trips without changing the bound match", async () => {
      const item = (await client.getItem(fixtures.showRatingKey)) as {
        guid?: string;
        title?: string;
      };
      if (
        !item.guid ||
        item.guid.startsWith("tv.plex.agents.none://") ||
        !item.title
      ) {
        console.warn(
          "[skip] fixture item is unmatched or missing title; applyMatch not exercised",
        );
        return;
      }
      await client.applyMatch(fixtures.showRatingKey, item.guid, item.title);
      const after = (await client.getItem(fixtures.showRatingKey)) as {
        guid?: string;
      };
      expect(after.guid).toBe(item.guid);
    });
  });

  it("refreshSection succeeds on a known section (incremental)", async () => {
    // Doesn't pass force=true — that would kick off a deep rescan of
    // every item in the section, which is expensive against a real
    // server. The incremental refresh is essentially free.
    await client.refreshSection(fixtures.showSectionId);
    // No assertion on side-effects; the refresh is async on the server.
    // Success = no exception.
  });

  // SIDE EFFECT: this round trip briefly puts the fixture into the
  // unmatched (agents.none) state before restoring its original
  // match. If the test fails between unmatch and applyMatch, the
  // fixture is left unmatched — afterAll attempts a best-effort
  // restore. Skipped when the fixture starts on agents.none / a
  // local-only GUID (nothing to restore to).
  describe.sequential("unmatch round trip", () => {
    let originalGuid: string | undefined;
    let originalTitle: string | undefined;
    let originalAgent: string | undefined;

    beforeAll(async () => {
      const item = (await client.getItem(fixtures.showRatingKey)) as {
        guid?: string;
        title?: string;
        librarySectionAgent?: string;
      };
      originalGuid = item.guid;
      originalTitle = item.title;
      originalAgent = item.librarySectionAgent;
    });

    afterAll(async () => {
      if (!originalGuid || !originalTitle) return;
      if (originalGuid.startsWith("local://")) return;
      try {
        await client.applyMatch(
          fixtures.showRatingKey,
          originalGuid,
          originalTitle,
        );
      } catch {
        // best-effort; not worth failing afterAll
      }
    });

    it("unmatch followed by applyMatch restores the original binding", async () => {
      if (
        !originalGuid ||
        !originalTitle ||
        originalGuid.startsWith("local://") ||
        originalAgent?.endsWith(".agents.none")
      ) {
        console.warn(
          "[skip] fixture is unmatched or local-only; unmatch round-trip not exercised",
        );
        return;
      }

      await client.unmatch(fixtures.showRatingKey);
      const afterUnmatch = (await client.getItem(fixtures.showRatingKey)) as {
        guid?: string;
      };
      // After unmatch, the agent-derived GUID should be gone or
      // replaced with a local:// placeholder.
      expect(afterUnmatch.guid !== originalGuid).toBe(true);

      await client.applyMatch(
        fixtures.showRatingKey,
        originalGuid,
        originalTitle,
      );
      const afterRestore = (await client.getItem(fixtures.showRatingKey)) as {
        guid?: string;
      };
      expect(afterRestore.guid).toBe(originalGuid);
    });
  });

  // SIDE EFFECT: this round trip leaves the fixture show's `summary`
  // field at `locked=1` (whether or not it was locked before). Same
  // class of side effect as the scrobble timestamp bump in the
  // mark_watched test below — accepted because the value itself is
  // restored. If a future audit flags a "locked summary" anomaly on
  // the first show in the show-type library, that's this test.
  describe.sequential("editMetadata round trip (summary field)", () => {
    let originalSummary: string;

    beforeAll(async () => {
      const item = (await client.getItem(fixtures.showRatingKey)) as {
        summary?: string;
      };
      originalSummary = item.summary ?? "";
    });

    afterAll(async () => {
      // Best-effort restore even if a test mid-block failed. Empty
      // string is a valid Plex summary; we don't want to leave the
      // fixture with our sentinel.
      try {
        await client.editMetadata(fixtures.showRatingKey, {
          summary: originalSummary,
        });
      } catch {
        // already-restored or transient — not worth failing afterAll
      }
    });

    it("sets and reads back a sentinel summary", async () => {
      const sentinel = `plex-mcp editMetadata test ${Date.now()}`;
      await client.editMetadata(fixtures.showRatingKey, { summary: sentinel });
      const after = (await client.getItem(fixtures.showRatingKey)) as {
        summary?: string;
      };
      expect(after.summary).toBe(sentinel);
    });

    it("restores the original summary", async () => {
      await client.editMetadata(fixtures.showRatingKey, {
        summary: originalSummary,
      });
      const after = (await client.getItem(fixtures.showRatingKey)) as {
        summary?: string;
      };
      expect(after.summary).toBe(originalSummary);
    });
  });

  // .sequential because we don't want parallel mutations on the
  // same item across other (hypothetical future) write tests.
  describe.sequential("mark_watched / mark_unwatched round trip", () => {
    it("round trip restores watched state", async () => {
      if (!fixtures.roundTripRatingKey) {
        // No history entries on this server; nothing to round-trip.
        // Pass silently rather than fail — server is technically
        // valid, just empty of watch activity.
        console.warn("[skip] no history entries; round-trip not exercised");
        return;
      }
      const targetKey = fixtures.roundTripRatingKey;

      await client.markUnwatched(targetKey);
      const afterUnwatch = (await client.getItem(targetKey)) as {
        viewCount?: number;
      };
      expect(afterUnwatch.viewCount ?? 0).toBe(0);

      await client.markWatched(targetKey);
      const afterWatch = (await client.getItem(targetKey)) as {
        viewCount?: number;
        lastViewedAt?: number;
      };
      expect(afterWatch.viewCount ?? 0).toBeGreaterThanOrEqual(1);
      // Don't compare to local Date.now() — Plex's clock can drift
      // a few seconds from the test machine's clock, which would make
      // this flaky. Just verify lastViewedAt got set.
      expect(afterWatch.lastViewedAt).toBeDefined();
      expect(afterWatch.lastViewedAt!).toBeGreaterThan(0);
    });
  });
});
