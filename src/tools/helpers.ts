// Shared helpers used by every tool registration.

import { log } from "../log.js";

export const asText = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

type ToolArgs = Record<string, unknown>;
type ToolResult = { content: Array<{ type: "text"; text: string }> };
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
