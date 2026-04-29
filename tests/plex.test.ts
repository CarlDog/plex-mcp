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
import { describe, it, expect, beforeAll } from "vitest";
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
