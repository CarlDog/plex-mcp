// Regression test for MCP-P07: MCP_IMAGE_MAX_BYTES="" must not disable the
// image size cap. Pure parsing logic, no live Plex needed — runs in CI
// alongside image-url-guard.test.ts, which the integration suite doesn't.
//
// Also covers resolveLogMaxBytes, the equivalent resolver for
// plex_download_logs — both share the resolveIntEnv implementation
// (phase-end audit finding, 2026-08-03), so both get the same contract
// tests including the zero/negative guard.

import { describe, expect, test } from "vitest";
import { resolveImageMaxBytes, resolveLogMaxBytes } from "../src/plex.js";

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

  test("falls back to the default for zero or negative", () => {
    // A non-positive cap doesn't fail loudly on its own (every real
    // response "exceeds" it), so treat it the same as an invalid value
    // rather than silently accepting a nonsensical config.
    expect(resolveImageMaxBytes("0")).toBe(4194304);
    expect(resolveImageMaxBytes("-1")).toBe(4194304);
  });

  test("uses an explicit numeric override", () => {
    expect(resolveImageMaxBytes("1048576")).toBe(1048576);
  });
});

describe("resolveLogMaxBytes", () => {
  test("falls back to the default when unset", () => {
    expect(resolveLogMaxBytes(undefined)).toBe(52_428_800);
  });

  test("falls back to the default for an empty string", () => {
    expect(resolveLogMaxBytes("")).toBe(52_428_800);
  });

  test("falls back to the default for a non-numeric value", () => {
    expect(resolveLogMaxBytes("not-a-number")).toBe(52_428_800);
  });

  test("falls back to the default for zero or negative", () => {
    expect(resolveLogMaxBytes("0")).toBe(52_428_800);
    expect(resolveLogMaxBytes("-1")).toBe(52_428_800);
  });

  test("uses an explicit numeric override", () => {
    expect(resolveLogMaxBytes("1048576")).toBe(1048576);
  });
});
