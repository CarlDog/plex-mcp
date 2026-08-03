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
 * - Logs an `invoke` line at info with the tool's args.
 * - Logs an `ok` line at info with elapsed ms.
 * - Logs an `error` line at error with elapsed ms + the error message,
 *   then re-throws so the MCP framework still surfaces an error result.
 *
 * Args values are logged verbatim — they are rating keys, section ids,
 * queries, etc. None are secret per our threat model (PLEX_TOKEN never
 * appears in tool args; it's a header inside PlexClient).
 */
export function withLogging<A extends ToolArgs>(
  name: string,
  handler: ToolHandler<A>,
): ToolHandler<A> {
  return async (args: A) => {
    const start = Date.now();
    log.info(`tool:${name}`, "invoke", args);
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
