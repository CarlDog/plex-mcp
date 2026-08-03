// Unit test for assertNameMatches (MCP-P06) — the core comparison logic
// behind the destructive-tool confirm gate. See
// tests/destructive-confirm-guard.test.ts for wiring-level coverage that
// each destructive tool actually calls this before mutating.

import { describe, expect, test } from "vitest";
import { assertNameMatches } from "../src/tools/helpers.js";

describe("assertNameMatches", () => {
  test("does not throw when names match exactly", () => {
    expect(() =>
      assertNameMatches("plex_test_tool", "My Playlist", "My Playlist"),
    ).not.toThrow();
  });

  test("throws when the resolved target has no name (unresolvable id)", () => {
    expect(() =>
      assertNameMatches("plex_test_tool", "My Playlist", undefined),
    ).toThrow(/could not resolve/);
  });

  test("throws when names don't match, quoting both in the message", () => {
    expect(() =>
      assertNameMatches("plex_test_tool", "Expected Title", "Actual Title"),
    ).toThrow(/"Expected Title".*"Actual Title"/);
  });

  test("is case-sensitive and whitespace-sensitive (exact match only)", () => {
    expect(() =>
      assertNameMatches("plex_test_tool", "my playlist", "My Playlist"),
    ).toThrow();
    expect(() =>
      assertNameMatches("plex_test_tool", "My Playlist ", "My Playlist"),
    ).toThrow();
  });
});
