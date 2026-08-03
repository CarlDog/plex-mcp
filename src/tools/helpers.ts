// Shared helpers used by every tool registration.

import { log } from "../log.js";

export const asText = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

export const asImage = (bytes: Buffer, mimeType: string) => ({
  content: [
    {
      type: "image" as const,
      data: bytes.toString("base64"),
      mimeType,
    },
  ],
});

/**
 * Validate that a caller-supplied image_url is a same-server relative
 * Plex path. Rejects absolute URLs AND protocol-relative forms:
 * `new URL("//attacker.tld/x", base)` resolves to attacker.tld, and
 * WHATWG URL parsing treats a backslash like a forward slash for
 * http(s), so "/\\attacker.tld/x" does too. Either would leak the
 * X-Plex-Token to an arbitrary host via fetchBinary.
 *
 * Defense in depth: PlexClient.fetchBinary also asserts the resolved
 * URL stays on the configured Plex origin.
 */
export function assertRelativePlexPath(
  toolName: string,
  imageUrl: string,
): void {
  if (
    !imageUrl.startsWith("/") ||
    imageUrl.startsWith("//") ||
    imageUrl.startsWith("/\\")
  ) {
    throw new Error(
      `${toolName}: image_url must be a relative Plex path starting with '/' (absolute and protocol-relative URLs are not allowed)`,
    );
  }
}

/**
 * Validate the entry-point args shared by plex_get_image/plex_save_image:
 * exactly one of rating_key/image_url must anchor the fetch, and a
 * provided image_url must be a safe relative Plex path. Kept in one
 * place so the two callers' argument contract can't drift.
 */
export function assertImageEntryPoint(
  toolName: string,
  ratingKey: string | undefined,
  imageUrl: string | undefined,
): void {
  if (!ratingKey && !imageUrl) {
    throw new Error(
      `${toolName}: either rating_key or image_url must be provided`,
    );
  }
  if (imageUrl) {
    assertRelativePlexPath(toolName, imageUrl);
  }
}

/**
 * Refuse an irreversible operation unless the caller's confirm_title
 * matches the resolved target's actual current title (MCP-P06). A
 * `confirm: true` flag alone is advisory — an autonomous agent can
 * always self-supply it. This can't be self-supplied the same way: a
 * transposed digit in a ratingKey resolves to a *different* item, whose
 * real title won't match what the caller expected, so the mismatch
 * surfaces before anything is deleted/consumed rather than after.
 *
 * `actualName` undefined means the target itself couldn't be resolved
 * (bad id) — reported distinctly from a resolved-but-mismatched title.
 */
export function assertNameMatches(
  toolName: string,
  expectedName: string,
  actualName: string | undefined,
): void {
  if (actualName === undefined) {
    throw new Error(
      `${toolName}: could not resolve the target to verify its name — check the id`,
    );
  }
  if (actualName !== expectedName) {
    throw new Error(
      `${toolName}: confirm_title "${expectedName}" does not match the resolved target's actual title "${actualName}" — refusing to proceed. Re-check the id, or pass the exact current title to confirm intent.`,
    );
  }
}

const REDACTED = "[redacted]";

/**
 * Strip client network-location fields from a plex_now_playing session
 * before it's returned (MCP-P04). Plex's live /status/sessions payload
 * includes a Player object carrying the viewing client's LAN address
 * (`address`) and, for sessions Plex sees as remote, its real public IP
 * (`remotePublicAddress`) — confirmed against a live capture, not just
 * the docs. Neither has anything to do with what this tool is for
 * (what's playing right now); both are the kind of viewer PII the
 * response shouldn't carry incidentally. This is deliberately narrow —
 * a fix for the one concrete exposure the audit found, not a general
 * response sanitizer. plex_history's entries carry no Player object at
 * all (verified against a live capture), so nothing to redact there.
 */
export function redactSessionPlayerAddress(session: unknown): unknown {
  if (typeof session !== "object" || session === null) return session;
  const player = (session as Record<string, unknown>).Player;
  if (typeof player !== "object" || player === null) return session;
  const redactedPlayer = { ...(player as Record<string, unknown>) };
  if ("address" in redactedPlayer) redactedPlayer.address = REDACTED;
  if ("remotePublicAddress" in redactedPlayer) {
    redactedPlayer.remotePublicAddress = REDACTED;
  }
  return { ...(session as Record<string, unknown>), Player: redactedPlayer };
}

// Per the MCP spec + ChatGPT Apps SDK metadata guide
// (docs/CHATGPT-APPS-SDK.md), tool annotations are hints to the
// client about a tool's behavior. They aren't enforced — clients
// should not make trust decisions based on them — but they
// improve the model's tool-selection heuristics.
//
// All plex-mcp tools have openWorldHint=false: every operation
// touches only the user's own Plex server, never publishes
// content or reaches outside the user's account.
export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  openWorldHint: false,
} as const;

// For mutating tools that don't delete or overwrite user data in
// a way that's hard to recover. Examples: mark_watched (reversible
// via mark_unwatched), edit_metadata (re-edit to restore), playlist
// add/remove (re-add the item), refresh (no data lost).
export const SAFE_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
} as const;

// For idempotent mutating tools — re-running has the same effect
// as running once. Helps clients avoid retry-loop hazards.
export const SAFE_IDEMPOTENT_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

// For genuinely destructive tools — data is removed or made
// inaccessible in a way the user can't trivially undo. Covers
// plex_delete_playlist (the playlist disappears; underlying media is
// untouched but the playlist's curation is gone) and plex_split_item /
// plex_merge_items (the original ratingKey(s) are consumed; a client
// should confirm before calling either).
export const DESTRUCTIVE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
} as const;

// For destructive tools that are still idempotent — re-running with the
// same args produces the same end state, but the state it replaced can't
// be recovered by any inverse operation this server exposes. The only
// instance today is plex_apply_match: re-applying the same guid is a
// no-op, but the item's prior binding (including "no match") is gone.
export const DESTRUCTIVE_IDEMPOTENT_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

type ToolArgs = Record<string, unknown>;
type TextBlock = { type: "text"; text: string };
type ImageBlock = { type: "image"; data: string; mimeType: string };
type ContentBlock = TextBlock | ImageBlock;
type ToolResult = { content: ContentBlock[] };
type ToolHandler<A extends ToolArgs> = (args: A) => Promise<ToolResult>;

/**
 * Wrap a tool handler with structured logging:
 * - Logs an `invoke` line at info with the tool's arg *keys* only.
 * - Logs a second `invoke` line at debug with the full arg values.
 * - Logs an `ok` line at info with elapsed ms.
 * - Logs an `error` line at error with elapsed ms + the error message,
 *   then re-throws so the MCP framework still surfaces an error result.
 *
 * Values (MCP-P05) — not just secrets — land in this split. None of our
 * args are ever secret (PLEX_TOKEN never appears in tool args; it's a
 * header inside PlexClient), but several carry real user content:
 * plex_search.query, plex_edit_metadata.fields.title/summary,
 * plex_save_image.filename. That content doesn't need to sit in the
 * default-level container logs of every session — keys-only at info
 * (which tool, which fields were passed) is enough for normal
 * operation; full values are one LOG_LEVEL=debug away when actually
 * debugging.
 */
export function withLogging<A extends ToolArgs>(
  name: string,
  handler: ToolHandler<A>,
): ToolHandler<A> {
  return async (args: A) => {
    const start = Date.now();
    log.info(`tool:${name}`, "invoke", { keys: Object.keys(args) });
    log.debug(`tool:${name}`, "invoke", args);
    try {
      const result = await handler(args);
      log.info(`tool:${name}`, "ok", { ms: Date.now() - start });
      return result;
    } catch (err) {
      log.error(`tool:${name}`, "error", {
        ms: Date.now() - start,
        msg: (err as Error).message,
      });
      throw err;
    }
  };
}
