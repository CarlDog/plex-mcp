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
// inaccessible in a way the user can't trivially undo. The only
// instance today is plex_delete_playlist (the playlist disappears;
// underlying media is untouched but the playlist's curation is
// gone).
export const DESTRUCTIVE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
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
