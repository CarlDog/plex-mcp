// Wiring tests for plex_set_subtitle_stream / plex_set_audio_stream:
// the registered handler must pass its arguments through to the right
// PlexClient method and translate the result into the documented
// snake_case shape, and the zod input schemas must enforce the one
// contract difference between the two tools (0 = off is subtitle-only).
// The locator logic itself is covered in stream-selection.test.ts.

import { describe, expect, it, vi } from "vitest";
import type { PlexClient } from "../src/plex.js";
import { registerTools } from "../src/tools/index.js";
import { CaptureServer, type CapturedTool } from "./_test_utils.js";

function registerAndFind(plex: PlexClient, toolName: string): CapturedTool {
  const server = new CaptureServer();
  registerTools(server as never, plex, {} as never);
  const tool = server.tools.find((t) => t.name === toolName);
  if (!tool) throw new Error(`tool not registered: ${toolName}`);
  return tool;
}

type Schema = Record<
  string,
  { safeParse: (v: unknown) => { success: boolean } }
>;

describe("plex_set_subtitle_stream", () => {
  it("calls setSubtitleStream and returns the selection result", async () => {
    const setSubtitleStream = vi.fn().mockResolvedValue({
      partId: "10",
      selectedStreamId: 105,
      previousStreamId: 104,
    });
    const plex = { setSubtitleStream } as unknown as PlexClient;
    const tool = registerAndFind(plex, "plex_set_subtitle_stream");

    const result = (await tool.handler({
      rating_key: "100",
      stream_id: 105,
    })) as { content: Array<{ text: string }> };

    expect(setSubtitleStream).toHaveBeenCalledWith("100", 105, undefined);
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      rating_key: "100",
      part_id: "10",
      selected_stream_id: 105,
      previous_stream_id: 104,
    });
  });

  it("forwards part_id for the off case", async () => {
    const setSubtitleStream = vi.fn().mockResolvedValue({
      partId: "20",
      selectedStreamId: 0,
      previousStreamId: 0,
    });
    const plex = { setSubtitleStream } as unknown as PlexClient;
    const tool = registerAndFind(plex, "plex_set_subtitle_stream");

    await tool.handler({ rating_key: "100", stream_id: 0, part_id: "20" });
    expect(setSubtitleStream).toHaveBeenCalledWith("100", 0, "20");
  });

  it("schema accepts stream_id 0 and rejects negatives/non-integers", () => {
    const tool = registerAndFind({} as PlexClient, "plex_set_subtitle_stream");
    const schema = tool.config.inputSchema as Schema;
    expect(schema.stream_id!.safeParse(0).success).toBe(true);
    expect(schema.stream_id!.safeParse(-1).success).toBe(false);
    expect(schema.stream_id!.safeParse(1.5).success).toBe(false);
    expect(schema.stream_id!.safeParse("105").success).toBe(false);
  });
});

describe("plex_set_audio_stream", () => {
  it("calls setAudioStream and returns the selection result", async () => {
    const setAudioStream = vi.fn().mockResolvedValue({
      partId: "10",
      selectedStreamId: 103,
      previousStreamId: 102,
    });
    const plex = { setAudioStream } as unknown as PlexClient;
    const tool = registerAndFind(plex, "plex_set_audio_stream");

    const result = (await tool.handler({
      rating_key: "100",
      stream_id: 103,
    })) as { content: Array<{ text: string }> };

    expect(setAudioStream).toHaveBeenCalledWith("100", 103);
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      rating_key: "100",
      part_id: "10",
      selected_stream_id: 103,
      previous_stream_id: 102,
    });
  });

  it("reports previous_stream_id as null when nothing was selected before", async () => {
    const setAudioStream = vi.fn().mockResolvedValue({
      partId: "10",
      selectedStreamId: 103,
      previousStreamId: 0,
    });
    const plex = { setAudioStream } as unknown as PlexClient;
    const tool = registerAndFind(plex, "plex_set_audio_stream");

    const result = (await tool.handler({
      rating_key: "100",
      stream_id: 103,
    })) as { content: Array<{ text: string }> };
    expect(JSON.parse(result.content[0]!.text).previous_stream_id).toBeNull();
  });

  it("schema rejects stream_id 0 (there is no audio off)", () => {
    const tool = registerAndFind({} as PlexClient, "plex_set_audio_stream");
    const schema = tool.config.inputSchema as Schema;
    expect(schema.stream_id!.safeParse(0).success).toBe(false);
    expect(schema.stream_id!.safeParse(1).success).toBe(true);
  });
});
