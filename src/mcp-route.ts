// The Streamable HTTP `/mcp` route: Host/Origin allowlist, optional bearer
// auth, per-session transport map, idle-session sweep, and session dispatch.
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
// `{ error }` body — a real response-shape difference, and its Host-rejection
// status is 421 where the shared module uses 403). Host *matching* itself,
// however, now delegates to src/shared/mcp-environment.ts
// (`requestAuthorityAllowed`) — the same fleet-canonical module ported into
// kindroid-mcp/servarr-mcp/filesystem-mcp/portainer-mcp/mnemosyne-mcp/
// plex-companion/downloader-mcp this pass — called with no `origin` key, so
// it validates Host only; the separate `allowedOrigins` check below stays
// this repo's own deliberate design (a distinct explicit allowlist rather
// than reusing allowedHosts for Origin matching, since a browser-facing
// frontend can legitimately live on a different hostname than the one MCP
// clients use to reach this server). The exact-match-on-host:port contract
// this route used to pin, and the later `host:port`-tolerant back-compat
// shim, are both retired: MCP_ALLOWED_HOSTS is validated strictly by
// src/config.ts at startup now, the same as every other fleet server.

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Express, NextFunction, Request, Response } from "express";
import { log } from "./log.js";
import { requestAuthorityAllowed } from "./shared/mcp-environment.js";

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
   * supported), via the shared `requestAuthorityAllowed()`. Empty rejects
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
   * Shared-secret bearer auth (`MCP_AUTH_TOKEN`), the same fleet-standard
   * mechanism every sibling MCP server supports. Runs AFTER checkHostAndOrigin
   * (cheaper, no-crypto check first) and BEFORE the OAuth `authMiddleware`
   * below — an independent, simpler layer for MCP clients (Claude Desktop/
   * Code) that don't speak OAuth, not a replacement for it. Unset leaves the
   * route open to this check (fail-soft, warned at startup by index.ts) —
   * matches every other fleet server's default.
   */
  authToken?: string | undefined;
  /**
   * Optional bearer-JWT auth (ChatGPT Apps SDK alignment, Phase 2 — see
   * src/auth.ts). Runs AFTER checkHostAndOrigin and the shared-secret
   * `authToken` check above: cheapest, no-crypto checks first, then the
   * simple constant-time comparison, then the more expensive JWKS-backed
   * verification. Omitted entirely when auth isn't configured
   * (MCP_OAUTH_ISSUER unset) — every existing caller of mountMcpRoute that
   * doesn't pass this gets identical behavior to before this option existed.
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
export function mountMcpRoute(
  app: Express,
  path: string,
  opts: McpRouteOptions,
): { dispose: () => Promise<void> } {
  const transports: Record<string, StreamableHTTPServerTransport> = {};
  const sessionLastActivity: Record<string, number> = {};

  function checkHostAndOrigin(
    req: Request,
    res: Response,
    next: () => void,
  ): void {
    if (
      !requestAuthorityAllowed({ host: req.headers.host }, opts.allowedHosts)
    ) {
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

  /** Constant-time bearer comparison over SHA-256 digests. */
  function tokenMatches(provided: string, expected: string): boolean {
    const a = createHash("sha256").update(provided).digest();
    const b = createHash("sha256").update(expected).digest();
    // Hashing first makes both sides fixed-length, so timingSafeEqual cannot
    // throw on a length mismatch — and length itself stops being an oracle.
    return timingSafeEqual(a, b);
  }

  function checkBearerToken(
    req: Request,
    res: Response,
    next: () => void,
  ): void {
    if (!opts.authToken) {
      next();
      return;
    }
    const header = req.headers.authorization;
    const provided =
      typeof header === "string" && header.startsWith("Bearer ")
        ? header.slice("Bearer ".length)
        : "";
    if (!provided || !tokenMatches(provided, opts.authToken)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  }

  const middlewares = [
    checkHostAndOrigin,
    checkBearerToken,
    ...(opts.authMiddleware ? [opts.authMiddleware] : []),
  ];

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
