// REGRESSION TEST for MCP-F01/F02: every outbound Plex request must
// carry a bounded timeout (a hung/half-open server would otherwise block
// a tool call indefinitely) and must retry a 429 honoring Retry-After,
// bounded so a large header value can't stall the whole request queue.
//
// Unit tests cover the two pure helpers directly; the last describe
// block is a wiring test — it mocks global fetch and drives an actual
// public PlexClient method (listLibraries, which calls the private
// request() -> fetchWithTimeoutAndRetry() chain) rather than only
// testing the helpers in isolation, so a call site that forgot to route
// through the chokepoint would still be caught.

import { describe, expect, test, afterEach, vi } from "vitest";
import {
  PlexClient,
  resolveFetchTimeoutMs,
  resolveLogFetchTimeoutMs,
  parseRetryAfterMs,
} from "../src/plex.js";

describe("resolveFetchTimeoutMs", () => {
  test("falls back to the default when unset", () => {
    expect(resolveFetchTimeoutMs(undefined)).toBe(30_000);
  });

  test("falls back to the default for an empty string", () => {
    expect(resolveFetchTimeoutMs("")).toBe(30_000);
  });

  test("falls back to the default for a non-numeric value", () => {
    expect(resolveFetchTimeoutMs("not-a-number")).toBe(30_000);
  });

  test("falls back to the default for zero or negative", () => {
    // Regression: AbortSignal.timeout(0) fires immediately and
    // AbortSignal.timeout(-1) throws a raw RangeError — both used to
    // reach fetchWithTimeoutAndRetry unvalidated (phase-end audit
    // finding, 2026-08-03), surfacing as a confusing "network error"
    // that never named the misconfigured env var.
    expect(resolveFetchTimeoutMs("0")).toBe(30_000);
    expect(resolveFetchTimeoutMs("-1")).toBe(30_000);
  });

  test("uses an explicit numeric override", () => {
    expect(resolveFetchTimeoutMs("5000")).toBe(5000);
  });
});

describe("resolveLogFetchTimeoutMs", () => {
  test("falls back to the default when unset", () => {
    expect(resolveLogFetchTimeoutMs(undefined)).toBe(120_000);
  });

  test("falls back to the default for an empty string", () => {
    expect(resolveLogFetchTimeoutMs("")).toBe(120_000);
  });

  test("falls back to the default for a non-numeric value", () => {
    expect(resolveLogFetchTimeoutMs("not-a-number")).toBe(120_000);
  });

  test("falls back to the default for zero or negative", () => {
    expect(resolveLogFetchTimeoutMs("0")).toBe(120_000);
    expect(resolveLogFetchTimeoutMs("-1")).toBe(120_000);
  });

  test("uses an explicit numeric override", () => {
    expect(resolveLogFetchTimeoutMs("5000")).toBe(5000);
  });
});

describe("parseRetryAfterMs", () => {
  test("defaults to 1000ms when the header is missing", () => {
    expect(parseRetryAfterMs(null)).toBe(1000);
  });

  test("parses an integer-seconds header", () => {
    expect(parseRetryAfterMs("5")).toBe(5000);
  });

  test("bounds a large integer-seconds header to the cap", () => {
    expect(parseRetryAfterMs("999")).toBe(30_000);
  });

  test("treats a negative value as zero wait, not a negative delay", () => {
    expect(parseRetryAfterMs("-5")).toBe(0);
  });

  test("parses an HTTP-date header", () => {
    const future = new Date(Date.now() + 10_000).toUTCString();
    const ms = parseRetryAfterMs(future);
    expect(ms).toBeGreaterThan(8_000);
    expect(ms).toBeLessThanOrEqual(10_000);
  });

  test("falls back to the default for a garbage header", () => {
    expect(parseRetryAfterMs("garbage")).toBe(1000);
  });
});

describe("fetchWithTimeoutAndRetry (via PlexClient.listLibraries)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("retries once on 429 honoring Retry-After, then succeeds", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("", {
          status: 429,
          headers: { "retry-after": "0" },
        });
      }
      return new Response(
        JSON.stringify({
          MediaContainer: { Directory: [{ title: "Movies" }] },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = new PlexClient({
      url: "http://plex.example:32400",
      token: "tok",
    });
    const libs = await client.listLibraries();
    expect(libs).toEqual([{ title: "Movies" }]);
    expect(callCount).toBe(2);
  });

  test("gives up after the retry cap and throws, without retrying forever", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      return new Response("", {
        status: 429,
        headers: { "retry-after": "0" },
      });
    }) as unknown as typeof fetch;

    const client = new PlexClient({
      url: "http://plex.example:32400",
      token: "tok",
    });
    await expect(client.listLibraries()).rejects.toThrow(/429/);
    expect(callCount).toBe(3); // initial attempt + 2 retries, then give up
  });

  test("passes an AbortSignal to every fetch call", async () => {
    let capturedSignal: unknown;
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      capturedSignal = init?.signal;
      return new Response(JSON.stringify({ MediaContainer: {} }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const client = new PlexClient({
      url: "http://plex.example:32400",
      token: "tok",
    });
    await client.listLibraries();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
  });
});
