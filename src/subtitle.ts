const HEARING_IMPAIRED_MARKER = /\b(?:sdh|hearing[\s-]?impaired)\b/i;

export function isHearingImpairedSubtitle(
  stream: Record<string, unknown>,
): boolean {
  if (typeof stream.hearingImpaired === "boolean") {
    return stream.hearingImpaired;
  }

  return [stream.title, stream.displayTitle, stream.extendedDisplayTitle].some(
    (value) => typeof value === "string" && HEARING_IMPAIRED_MARKER.test(value),
  );
}

export function annotateSubtitleStream(
  stream: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...stream,
    hearingImpaired: isHearingImpairedSubtitle(stream),
  };
}
