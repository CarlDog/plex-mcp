// Unit tests for the pure stream locator behind plex_set_subtitle_stream /
// plex_set_audio_stream. No Plex needed: the item shapes are literal
// copies of the Media[].Part[].Stream[] structure getItem returns.

import { describe, expect, it } from "vitest";
import { locateStream } from "../src/stream-selection.js";

const item = {
  ratingKey: "100",
  Media: [
    {
      id: 1,
      Part: [
        {
          id: 10,
          Stream: [
            { id: 101, streamType: 1, codec: "h264" },
            { id: 102, streamType: 2, language: "English", selected: true },
            { id: 103, streamType: 2, language: "Dutch" },
            { id: 104, streamType: 3, language: "English", selected: true },
            { id: 105, streamType: 3, language: "Dutch" },
          ],
        },
      ],
    },
    {
      id: 2,
      Part: [
        {
          id: 20,
          Stream: [
            { id: 201, streamType: 1 },
            { id: 202, streamType: 2 },
            { id: 203, streamType: 3, language: "French" },
          ],
        },
      ],
    },
  ],
};

describe("locateStream", () => {
  it("resolves the owning part and the previously selected subtitle", () => {
    expect(locateStream(item, "subtitle", 105)).toEqual({
      partId: "10",
      previousStreamId: 104,
    });
  });

  it("finds a stream on a second media version", () => {
    expect(locateStream(item, "subtitle", 203)).toEqual({
      partId: "20",
      previousStreamId: 0,
    });
  });

  it("resolves audio streams the same way", () => {
    expect(locateStream(item, "audio", 103)).toEqual({
      partId: "10",
      previousStreamId: 102,
    });
  });

  it("refuses a stream id of the wrong kind", () => {
    expect(() => locateStream(item, "subtitle", 102)).toThrow(
      /not a subtitle stream.*streamType 2/,
    );
    expect(() => locateStream(item, "audio", 104)).toThrow(
      /not an? audio stream/,
    );
  });

  it("refuses a stream id that is not on the item and lists what is", () => {
    expect(() => locateStream(item, "subtitle", 999)).toThrow(
      /not a stream on this item.*104, 105, 203/,
    );
  });

  it("stream_id 0 targets the first part by default and reports the previous selection", () => {
    expect(locateStream(item, "subtitle", 0)).toEqual({
      partId: "10",
      previousStreamId: 104,
    });
  });

  it("stream_id 0 honours an explicit part_id and rejects an unknown one", () => {
    expect(locateStream(item, "subtitle", 0, "20")).toEqual({
      partId: "20",
      previousStreamId: 0,
    });
    expect(() => locateStream(item, "subtitle", 0, "99")).toThrow(
      /part_id 99 is not a Media.Part.*available: 10, 20/,
    );
  });

  it("stream_id 0 is refused for audio", () => {
    expect(() => locateStream(item, "audio", 0)).toThrow(
      /only valid for subtitles/,
    );
  });

  it("refuses containers without media parts", () => {
    expect(() =>
      locateStream({ ratingKey: "1", type: "show" }, "subtitle", 1),
    ).toThrow(/no Media\/Part entries/);
  });
});
