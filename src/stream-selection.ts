// Pure stream-selection logic for plex_set_subtitle_stream /
// plex_set_audio_stream. Kept free of I/O so it can be unit-tested
// against literal item shapes without a Plex server.
//
// Plex's Stream.streamType: 1 = video, 2 = audio, 3 = subtitle (see
// PlexClient.getItem's minimal-mode comment for how that was confirmed).
// Selection is per media *part*: `PUT /library/parts/{partId}?
// subtitleStreamID={id}&allParts=1` (or `audioStreamID`). The caller
// supplies a stream id, and this module finds which part owns it — that
// lookup doubles as validation: an id that isn't on this item, or is the
// wrong kind of stream, is refused before anything is sent to Plex.

export const AUDIO_STREAM_TYPE = 2;
export const SUBTITLE_STREAM_TYPE = 3;

export type StreamKind = "audio" | "subtitle";

export const STREAM_TYPE_BY_KIND: Record<StreamKind, number> = {
  audio: AUDIO_STREAM_TYPE,
  subtitle: SUBTITLE_STREAM_TYPE,
};

export const STREAM_PARAM_BY_KIND: Record<StreamKind, string> = {
  audio: "audioStreamID",
  subtitle: "subtitleStreamID",
};

export interface StreamLocation {
  /** The Media.Part id whose stream selection will be changed. */
  partId: string;
  /** The currently selected stream of this kind in that part; 0 if none. */
  previousStreamId: number;
}

interface PlexStream {
  id?: unknown;
  streamType?: unknown;
  selected?: unknown;
}

interface PlexPart {
  id?: unknown;
  Stream?: unknown;
}

function partsOf(item: Record<string, unknown>): PlexPart[] {
  const media = Array.isArray(item.Media)
    ? (item.Media as Array<Record<string, unknown>>)
    : [];
  const parts: PlexPart[] = [];
  for (const m of media) {
    if (Array.isArray(m.Part)) parts.push(...(m.Part as PlexPart[]));
  }
  return parts;
}

function streamsOf(part: PlexPart): PlexStream[] {
  return Array.isArray(part.Stream) ? (part.Stream as PlexStream[]) : [];
}

function selectedStreamId(part: PlexPart, kind: StreamKind): number {
  const wanted = STREAM_TYPE_BY_KIND[kind];
  const selected = streamsOf(part).find(
    (s) => s.streamType === wanted && s.selected === true,
  );
  return typeof selected?.id === "number" ? selected.id : 0;
}

/**
 * Resolve which part a stream-selection call should target, and what
 * was selected there before.
 *
 * - `streamId > 0`: the part is the one whose `Stream[]` contains that
 *   id, and the stream must be of `kind`. `partId` is ignored — the
 *   stream itself pins the part.
 * - `streamId === 0` ("off", subtitles only): there is no stream to
 *   derive the part from, so the first part is used unless `partId`
 *   names one explicitly (items with several versions/files).
 *
 * Throws a caller-actionable Error on every mismatch; nothing here
 * touches the network.
 */
export function locateStream(
  item: Record<string, unknown>,
  kind: StreamKind,
  streamId: number,
  partId?: string,
): StreamLocation {
  const parts = partsOf(item);
  if (parts.length === 0) {
    throw new Error(
      "item has no Media/Part entries — stream selection only applies to playable items (episodes, movies, tracks), not containers like shows or seasons",
    );
  }

  if (streamId === 0) {
    if (kind !== "subtitle") {
      throw new Error("stream_id 0 (off) is only valid for subtitles");
    }
    const target =
      partId === undefined
        ? parts[0]
        : parts.find((p) => String(p.id) === partId);
    if (!target) {
      throw new Error(
        `part_id ${partId} is not a Media.Part of this item (available: ${parts
          .map((p) => String(p.id))
          .join(", ")})`,
      );
    }
    return {
      partId: String(target.id),
      previousStreamId: selectedStreamId(target, kind),
    };
  }

  for (const part of parts) {
    const stream = streamsOf(part).find((s) => s.id === streamId);
    if (!stream) continue;
    const wanted = STREAM_TYPE_BY_KIND[kind];
    if (stream.streamType !== wanted) {
      throw new Error(
        `stream_id ${streamId} is not a ${kind} stream on this item (streamType ${String(stream.streamType)}, expected ${wanted})`,
      );
    }
    return {
      partId: String(part.id),
      previousStreamId: selectedStreamId(part, kind),
    };
  }

  const available = parts
    .flatMap((p) => streamsOf(p))
    .filter((s) => s.streamType === STREAM_TYPE_BY_KIND[kind])
    .map((s) => String(s.id));
  throw new Error(
    `stream_id ${streamId} is not a stream on this item (available ${kind} stream ids: ${
      available.length > 0 ? available.join(", ") : "none"
    })`,
  );
}
