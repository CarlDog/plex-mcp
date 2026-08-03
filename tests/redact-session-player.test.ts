// REGRESSION TEST for MCP-P04: plex_now_playing must not leak a viewing
// client's LAN/public IP. Confirmed against a live capture that Plex's
// /status/sessions response carries Player.address (LAN IP) and
// Player.remotePublicAddress (the viewer's real public IP) — neither has
// anything to do with what's playing.

import { describe, expect, test } from "vitest";
import { redactSessionPlayerAddress } from "../src/tools/helpers.js";

describe("redactSessionPlayerAddress", () => {
  test("redacts Player.address and Player.remotePublicAddress", () => {
    const session = {
      title: "Some Episode",
      Player: {
        address: "192.168.1.25",
        remotePublicAddress: "203.0.113.7",
        device: "Roku Streaming Stick+",
        local: true,
      },
    };
    const result = redactSessionPlayerAddress(session) as typeof session;
    expect(result.Player.address).toBe("[redacted]");
    expect(result.Player.remotePublicAddress).toBe("[redacted]");
  });

  test("preserves non-address Player fields and top-level fields", () => {
    const session = {
      title: "Some Episode",
      ratingKey: "123",
      Player: {
        address: "192.168.1.25",
        device: "Roku Streaming Stick+",
        local: true,
      },
    };
    const result = redactSessionPlayerAddress(session) as {
      title: string;
      ratingKey: string;
      Player: { device: string; local: boolean };
    };
    expect(result.title).toBe("Some Episode");
    expect(result.ratingKey).toBe("123");
    expect(result.Player.device).toBe("Roku Streaming Stick+");
    expect(result.Player.local).toBe(true);
  });

  test("passes through a session with no Player object unchanged", () => {
    const session = { title: "Some Episode", ratingKey: "123" };
    expect(redactSessionPlayerAddress(session)).toEqual(session);
  });

  test("passes through non-object input unchanged", () => {
    expect(redactSessionPlayerAddress(null)).toBeNull();
    expect(redactSessionPlayerAddress(undefined)).toBeUndefined();
    expect(redactSessionPlayerAddress("not an object")).toBe("not an object");
  });
});
