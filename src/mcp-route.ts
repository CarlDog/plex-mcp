// The Streamable HTTP `/mcp` route: Host/Origin allowlist, per-session
// transport map, idle-session sweep, and session dispatch.
//
// Extracted from index.ts purely to create a test seam. index.ts self-executes
// on import — it either starts a listener or connects stdio at module scope —
// so while this logic lived inline in an `if (port) { ... }` block there was
// nothing importable, and the session-status rules below could only be checked
// by hand against a running build. Behavior is unchanged from the inline
// version; see mcp-route.test.ts for what is now pinned.
//
// Still NOT sharing the fleet-canonical src/shared/http-transport.ts wholesale
// (this route keeps JSON-RPC error envelopes, not the shared module's bare
// `{ error }` body — a real response-shape difference, and this repo predates
// the shared module per STATUS.md MCP-S01). Host matching, however, is now
// aligned with the rest of the fleet: hostname-only, port-independent, via the
// same URL-authority parser plex-companion's fix (2026-08-30) introduced for
// bracketed IPv6. The exact-match-on-host:port contract this used to pin was a
// holdover from before that convention existed, not a stronger security
// posture — a DNS-rebinding attacker's Host header port is pinned by the real
// TCP connection (the browser must dial the actual published port to reach
// this socket at all), and an attacker who can already reach the port can
// trivially send the right one anyway. The allowlist defends hostnames, not
// ports. Allowlist entries may still carry a `host:port` form (the port is
// simply ignored) so an old-style deployed value keeps working unchanged.

import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Express, NextFunction, Request, Response } from "express";
import { log } from "./log.js";

export interface McpRouteOptions {
  /**
   * Builds a NEW McpServer with every tool registered.
   *
   * Must be a factory, not a shared instance: one McpServer reused across
   * HTTP sessions breaks after the first — and it works fine under stdio, so
   * light testing never catches it.
   */
  createServer: () => McpServer;
  /**
   * `Host` header hostnames accepted on this route, matched case-insensitively
   * and independent of port (e.g. `your-nas`; bracketed IPv6 like `[::1]` is
   * supported). A `host:port` entry also works — the port is ignored — so an
   * old-style deployed value keeps matching unchanged. Empty rejects
   * everything; config.ts refuses to start HTTP mode without it, so that
   * state is unreachable in production.
   */
  allowedHosts: string[];
  /**
   * Exact `Origin` header values accepted. Empty means every request that
   * carries an Origin at all is rejected — correct for a machine-to-machine
   * API, where the only callers sending one are browsers.
   */
  allowedOrigins: string[];
  sessionIdleTimeoutMs: number;
  /**
   * Sweep cadence. Defaults to the lesser of the idle timeout and 5 minutes,
   * so a short custom timeout doesn't wait a full default cycle to take
   * effect.
   */
  sweepIntervalMs?: number;
  /**
   * Optional bearer-token auth (ChatGPT Apps SDK alignment, Phase 2 — see
   * src/auth.ts). Runs AFTER checkHostAndOrigin below: the Host/Origin
   * allowlist is the cheaper, no-crypto defense and should reject a
   * spoofed Host before this does any JWKS work. Omitted entirely when
   * auth isn't configured (MCP_OAUTH_ISSUER unset) — every existing
   * caller of mountMcpRoute that doesn't pass this gets identical
   * behavior to before this option existed.
   */
  authMiddleware?: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => void | Promise<void>;
}

/**
 * Mount the MCP Streamable HTTP endpoint on an Express app.
 *
 * Returns a dispose() that clears the sweep timer and closes live sessions, so
 * tests and graceful shutdown don't leak handles.
 */
/**
 * Extract the hostname portion of a `Host`-header-style authority string,
 * independent of any port suffix. Uses URL parsing (not a colon-split) so
 * bracketed IPv6 (`[::1]:3009`) resolves to `[::1]`, not the mangled `[` a
 * naive split produces — see plex-companion's 2026-08-30 IPv6 fix, which this
 * mirrors. Returns undefined for anything that isn't a bare authority (a
 * userinfo, path, query, or fragment component means the header was not a
 * plain host[:port] value).
 */
export function hostnameFromAuthority(
  value: string | undefined,
): string | undefined {
  try {
    const authority = new URL(`http://${value ?? ""}`);
    if (
      authority.username ||
      authority.password ||
      authority.pathname !== "/" ||
      authority.search ||
      authority.hash
    ) {
      return undefined;
    }
    return authority.hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function mountMcpRoute(
  app: Express,
  path: string,
  opts: McpRouteOptions,
): { dispose: () => Promise<void> } {
  const transports: Record<string, StreamableHTTPServerTransport> = {};
  const sessionLastActivity: Record<string, number> = {};

  // Normalized once at mount time, not per-request: strips a port suffix off
  // each configured entry too, so a deployed value that still says
  // `your-nas:3001` (the pre-alignment format) keeps matching without an env
  // change.
  const normalizedAllowedHosts = opts.allowedHosts.map(
    (h) => hostnameFromAuthority(h) ?? h.toLowerCase(),
  );

  function checkHostAndOrigin(
    req: Request,
    res: Response,
    next: () => void,
  ): void {
    const host = hostnameFromAuthority(req.headers.host);
    if (!host || !normalizedAllowedHosts.includes(host)) {
      log.warn("transport", "rejected: disallowed Host header", {
        host: req.headers.host,
      });
      res.status(421).json({ error: "Invalid Host header" });
      return;
    }
    const origin = req.headers.origin;
    if (origin && !opts.allowedOrigins.includes(origin)) {
      log.warn("transport", "rejected: disallowed Origin header", { origin });
      res.status(403).json({ error: "Invalid Origin header" });
      return;
    }
    next();
  }

  const middlewares = opts.authMiddleware
    ? [checkHostAndOrigin, opts.authMiddleware]
    : [checkHostAndOrigin];

  app.all(path, ...middlewares, async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
        sessionLastActivity[sessionId] = Date.now();
      } else if (
        !sessionId &&
        req.method === "POST" &&
        isInitializeRequest(req.body)
      ) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports[id] = transport;
            sessionLastActivity[id] = Date.now();
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) {
            delete transports[transport.sessionId];
            delete sessionLastActivity[transport.sessionId];
          }
        };
        const server = opts.createServer();
        await server.connect(transport);
      } else if (sessionId) {
        // A session id we don't recognise: evicted by the idle sweep, or the
        // process restarted under a live client. The spec REQUIRES 404 here —
        // it is the client's ONLY defined signal to start a new session by
        // re-initializing (2025-06-18, Session Management §3/§4). A 400 reads
        // as a generic protocol error, so the client stays wedged until a
        // human restarts it: a routine eviction becomes a dead connection.
        res.status(404).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Not Found: unknown or expired session",
          },
          id: null,
        });
        return;
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: non-initialize request without a session",
          },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error("transport", "MCP request error", {
        msg: (err as Error).message,
      });
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Sweep idle sessions. Unref'd so it never keeps the process alive on its
  // own.
  const sweepIntervalMs =
    opts.sweepIntervalMs ?? Math.min(opts.sessionIdleTimeoutMs, 5 * 60_000);
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, lastActivity] of Object.entries(sessionLastActivity)) {
      if (now - lastActivity <= opts.sessionIdleTimeoutMs) continue;
      log.info("transport", "evicting idle session", {
        sessionId: id,
        idleMs: now - lastActivity,
      });
      const transport = transports[id];
      delete transports[id];
      delete sessionLastActivity[id];
      transport?.close().catch((err: unknown) => {
        log.error("transport", "error closing idle session", {
          sessionId: id,
          msg: (err as Error).message,
        });
      });
    }
  }, sweepIntervalMs);
  sweep.unref();

  return {
    dispose: async () => {
      clearInterval(sweep);
      await Promise.all(
        Object.values(transports).map((t) =>
          t.close().catch(() => {
            /* already gone; nothing to release */
          }),
        ),
      );
    },
  };
}
