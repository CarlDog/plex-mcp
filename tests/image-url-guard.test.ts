// Unit tests for the image_url validation guard — no Plex server
// required, so these run in CI where tests/plex.test.ts skips.
//
// Covers the token-exfiltration/SSRF shapes: an image_url like
// "//attacker.tld/x" satisfies startsWith("/") but resolves to an
// arbitrary host under `new URL(path, base)`, and WHATWG URL parsing
// treats "/\\attacker.tld/x" the same way for http(s). Both layers
// are tested: the tool-layer guard (assertRelativePlexPath) and the
// PlexClient.fetchBinary same-origin choke point (via getImageBytes).
import { describe, it, expect } from "vitest";
import { assertRelativePlexPath } from "../src/tools/helpers.js";
import { PlexClient } from "../src/plex.js";

describe("assertRelativePlexPath (tool-layer image_url guard)", () => {
  it("accepts a normal relative Plex path", () => {
    expect(() =>
      assertRelativePlexPath(
        "plex_get_image",
        "/library/metadata/209640/thumb/1779038021",
      ),
    ).not.toThrow();
  });

  it("rejects a path without a leading slash", () => {
    expect(() =>
      assertRelativePlexPath("plex_get_image", "library/metadata/1/thumb/2"),
    ).toThrow(/relative Plex path/);
  });

  it("rejects an absolute URL", () => {
    expect(() =>
      assertRelativePlexPath("plex_get_image", "https://attacker.tld/x"),
    ).toThrow(/relative Plex path/);
  });

  it("rejects a protocol-relative URL (//attacker.tld/x)", () => {
    expect(() =>
      assertRelativePlexPath("plex_get_image", "//attacker.tld/x"),
    ).toThrow(/relative Plex path/);
  });

  it("rejects a backslash protocol-relative URL (/\\attacker.tld/x)", () => {
    expect(() =>
      assertRelativePlexPath("plex_save_image", "/\\attacker.tld/x"),
    ).toThrow(/relative Plex path/);
  });
});

describe("PlexClient.fetchBinary same-origin assertion (via getImageBytes)", () => {
  const client = new PlexClient({
    url: "http://plex.local:32400",
    token: "test-token",
  });

  it("rejects a protocol-relative imageUrl before any network call", async () => {
    await expect(
      client.getImageBytes({ imageUrl: "//attacker.tld/steal" }),
    ).rejects.toThrow(/refusing off-server URL/);
  });

  it("rejects a backslash protocol-relative imageUrl", async () => {
    await expect(
      client.getImageBytes({ imageUrl: "/\\attacker.tld/steal" }),
    ).rejects.toThrow(/refusing off-server URL/);
  });

  it("rejects an absolute imageUrl on another host", async () => {
    await expect(
      client.getImageBytes({ imageUrl: "https://attacker.tld/steal" }),
    ).rejects.toThrow(/refusing off-server URL/);
  });
});
