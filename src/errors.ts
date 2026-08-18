// Small shared error-formatting helper. Not a shared/errors.ts adoption
// (this repo predates that fleet convention and has no ApiError/retry-policy
// machinery to go with it) -- just the one piece both plex.ts and auth.ts
// need.

/**
 * Describe a transport-level failure with its real cause.
 *
 * Node's global `fetch()` throws a bare `TypeError: fetch failed` on any
 * network-level error (DNS, connect, TLS) -- the actual reason lives in
 * `error.cause` and is discarded if nothing reads it, making a live
 * connectivity fault undiagnosable from the tool's error output alone
 * (fleet standard MCP-F08). Must be folded into the thrown error's message
 * itself: the MCP SDK's own tool-error conversion reads `error.message`
 * only, so `cause` would otherwise be discarded again at that boundary.
 */
export function describeTransportError(err: unknown): string {
  const base = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? err.cause : undefined;
  const causeMsg =
    cause instanceof Error ? cause.message : cause ? String(cause) : "";
  return causeMsg ? `${base}: ${causeMsg}` : base;
}
