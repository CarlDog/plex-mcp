import { describe, expect, it } from "vitest";
import { itemHasExternalGuid } from "../src/plex.js";

describe("itemHasExternalGuid", () => {
  it("matches an exact child GUID", () => {
    const item = {
      Guid: [{ id: "plex://show/abc" }, { id: "tvdb://12345" }],
    };
    expect(itemHasExternalGuid(item, "tvdb://12345")).toBe(true);
  });

  it("does not accept prefixes, case variants, or a primary guid field", () => {
    const item = {
      guid: "tvdb://12345",
      Guid: [{ id: "tvdb://123456" }, { id: "TVDB://12345" }],
    };
    expect(itemHasExternalGuid(item, "tvdb://12345")).toBe(false);
  });

  it("fails closed for malformed Guid payloads", () => {
    expect(itemHasExternalGuid(null, "imdb://tt0133093")).toBe(false);
    expect(
      itemHasExternalGuid(
        { Guid: [null, "imdb://tt0133093", {}] },
        "imdb://tt0133093",
      ),
    ).toBe(false);
  });
});
