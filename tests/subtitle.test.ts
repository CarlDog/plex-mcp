import { describe, expect, it } from "vitest";
import {
  annotateSubtitleStream,
  isHearingImpairedSubtitle,
} from "../src/subtitle.js";

describe("subtitle hearing-impaired annotation", () => {
  it("derives true from SDH and hearing-impaired display markers", () => {
    expect(isHearingImpairedSubtitle({ title: "SDH" })).toBe(true);
    expect(isHearingImpairedSubtitle({ displayTitle: "English (sdh)" })).toBe(
      true,
    );
    expect(
      isHearingImpairedSubtitle({
        extendedDisplayTitle: "English hearing-impaired subtitles",
      }),
    ).toBe(true);
  });

  it("does not treat unrelated text or an embedded sdh token as a marker", () => {
    expect(isHearingImpairedSubtitle({ title: "English" })).toBe(false);
    expect(isHearingImpairedSubtitle({ title: "SdhCodecTest" })).toBe(false);
  });

  it("preserves a native Plex boolean when one is present", () => {
    expect(
      isHearingImpairedSubtitle({ title: "Plain", hearingImpaired: true }),
    ).toBe(true);
    expect(
      isHearingImpairedSubtitle({ title: "SDH", hearingImpaired: false }),
    ).toBe(false);
  });

  it("always adds a boolean without mutating the source stream", () => {
    const source = { id: 1, streamType: 3, title: "SDH" };
    const annotated = annotateSubtitleStream(source);

    expect(annotated).toEqual({ ...source, hearingImpaired: true });
    expect(source).not.toHaveProperty("hearingImpaired");
  });
});
