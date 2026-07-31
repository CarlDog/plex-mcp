// Regression test for MCP-P07: MCP_IMAGE_MAX_BYTES="" must not disable the
// image size cap. Pure parsing logic, no live Plex needed — runs in CI
// alongside image-url-guard.test.ts, which the integration suite doesn't.

import { describe, expect, test } from "vitest";
import { resolveImageMaxBytes } from "../src/plex.js";

describe("resolveImageMaxBytes", () => {
  test("falls back to the default when unset", () => {
    expect(resolveImageMaxBytes(undefined)).toBe(4194304);
  });

  test("falls back to the default for an empty string", () => {
    // Some MCP hosts inject "" for a blank config field rather than
    // leaving it unset — this is the exact case that used to produce
    // NaN and silently disable the cap.
    expect(resolveImageMaxBytes("")).toBe(4194304);
  });

  test("falls back to the default for a non-numeric value", () => {
    expect(resolveImageMaxBytes("not-a-number")).toBe(4194304);
  });

  test("uses an explicit numeric override", () => {
    expect(resolveImageMaxBytes("1048576")).toBe(1048576);
  });
});
