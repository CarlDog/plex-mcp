// REGRESSION TEST for MCP-P05: tool invocation must log arg *keys* at
// info and full arg *values* only at debug. Args carry real user content
// (plex_search.query, plex_edit_metadata.fields.title/summary,
// plex_save_image.filename) that doesn't belong in default-level
// container logs.

import { describe, expect, test, vi } from "vitest";
import { log } from "../src/log.js";
import { withLogging } from "../src/tools/helpers.js";

describe("withLogging (MCP-P05)", () => {
  test("logs only arg keys at info; full values only at debug", async () => {
    const infoSpy = vi.spyOn(log, "info").mockImplementation(() => undefined);
    const debugSpy = vi.spyOn(log, "debug").mockImplementation(() => undefined);

    const handler = withLogging<{ query: string }>(
      "plex_test_tool",
      async () => ({
        content: [{ type: "text" as const, text: "ok" }],
      }),
    );
    await handler({ query: "sensitive search terms" });

    const infoInvoke = infoSpy.mock.calls.find((c) => c[1] === "invoke");
    expect(infoInvoke?.[2]).toEqual({ keys: ["query"] });
    // The literal value must never appear anywhere in the info call.
    expect(JSON.stringify(infoInvoke)).not.toContain("sensitive search terms");

    const debugInvoke = debugSpy.mock.calls.find((c) => c[1] === "invoke");
    expect(debugInvoke?.[2]).toEqual({ query: "sensitive search terms" });

    infoSpy.mockRestore();
    debugSpy.mockRestore();
  });

  test("still logs ok/error at info as before", async () => {
    const infoSpy = vi.spyOn(log, "info").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => undefined);
    vi.spyOn(log, "debug").mockImplementation(() => undefined);

    const okHandler = withLogging("plex_test_tool", async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }));
    await okHandler({});
    expect(infoSpy.mock.calls.some((c) => c[1] === "ok")).toBe(true);

    const failHandler = withLogging("plex_test_tool", async () => {
      throw new Error("boom");
    });
    await expect(failHandler({})).rejects.toThrow("boom");
    expect(errorSpy.mock.calls.some((c) => c[1] === "error")).toBe(true);

    vi.restoreAllMocks();
  });
});
