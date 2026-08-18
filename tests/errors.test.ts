import { describe, expect, test } from "vitest";
import { describeTransportError } from "../src/errors.js";

describe("describeTransportError", () => {
  test("appends the cause's message when present", () => {
    const cause = new Error("connect ECONNREFUSED 127.0.0.1:32400");
    const err = new Error("fetch failed", { cause });
    expect(describeTransportError(err)).toBe(
      "fetch failed: connect ECONNREFUSED 127.0.0.1:32400",
    );
  });

  test("falls back to the bare message when there is no cause", () => {
    const err = new Error("timed out");
    expect(describeTransportError(err)).toBe("timed out");
  });

  test("handles a non-Error thrown value", () => {
    expect(describeTransportError("plain string throw")).toBe(
      "plain string throw",
    );
  });
});
