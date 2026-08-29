// Startup configuration boundary (MCP-S01, partial adoption — see
// STATUS.md for the full reasoning). Centralizes the env vars that were
// already read and validated eagerly at module-load time in
// src/index.ts, preserving their exact validate-or-exit(1) semantics —
// just in one place instead of scattered across ~40 lines.
//
// Deliberately NOT centralized here:
// - src/tls.ts's MCP_TLS_* vars: read lazily, only when HTTP+TLS mode
//   actually runs. Forcing them into this eager module-load-time read
//   would change observable behavior — an invalid MCP_TLS_DAYS would
//   start failing stdio-mode startups it doesn't affect today.
// - src/plex.ts's MCP_IMAGE_SAVE_DIR / MCP_IMAGE_MAX_BYTES /
//   MCP_FETCH_TIMEOUT_MS / MCP_LOG_SAVE_DIR / MCP_LOG_MAX_BYTES /
//   MCP_LOG_FETCH_TIMEOUT_MS: already behind well-tested pure resolve*()
//   functions, read once per call rather than once at import time. Real
//   difference is negligible (env vars don't change during a running
//   container's life) and not worth the churn.

import { log } from "./log.js";
import { resolveTautulliConfig, type TautulliConfigState } from "./tautulli.js";

function fail(message: string, meta?: Record<string, unknown>): never {
  log.error("startup", message, meta);
  process.exit(1);
}

export interface Config {
  plexUrl: string;
  plexToken: string;
  port: number | null;
  allowedHosts: string[];
  allowedOrigins: string[];
  sessionIdleTimeoutMs: number;
  tautulli: TautulliConfigState;
}

function loadConfig(): Config {
  const plexUrl = process.env.PLEX_URL;
  const plexToken = process.env.PLEX_TOKEN;
  if (!plexUrl || !plexToken) {
    fail("PLEX_URL and PLEX_TOKEN environment variables are required");
  }

  const portStr = process.env.MCP_PORT;
  const port = portStr ? Number.parseInt(portStr, 10) : null;
  if (portStr && (port === null || Number.isNaN(port))) {
    fail("Invalid MCP_PORT", { value: portStr });
  }

  // DNS-rebinding defense (MCP-F03): binding 0.0.0.0 inside a container
  // isn't a real access boundary the way loopback is on a bare host — a
  // page loaded in a browser on the LAN can rebind its own hostname to
  // this container's IP and drive tools (including writes) as a
  // confused deputy, entirely bypassing "LAN-only" as a security
  // posture. The MCP SDK's built-in allowedHosts/allowedOrigins are
  // deprecated in favor of external middleware, so it's enforced in
  // src/index.ts's own guard instead. Required (not opt-in) in HTTP
  // mode: an HTTP MCP server with no Host allowlist at all is the gap,
  // not a degraded-but-working default.
  const allowedHosts = (process.env.MCP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  // Origins are a browser-only concept; a legitimate non-browser client
  // (the mcp-remote bridge, a direct fetch) never sends one. Default
  // empty means "reject every browser-originated request" — the correct
  // posture for a pure machine-to-machine API where the only requests
  // that should ever carry an Origin header are exactly the
  // DNS-rebinding attack this guards against.
  const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  if (port && allowedHosts.length === 0) {
    fail(
      "MCP_ALLOWED_HOSTS is required in HTTP mode: comma-separated Host header values this server accepts on /mcp (e.g. 'your-nas:3001'). Defends against DNS rebinding — see docker-deployments.md rule #8.",
    );
  }

  // Idle MCP sessions leak otherwise: transports only get cleaned up via
  // client-initiated onclose (a DELETE, or a graceful disconnect). A
  // client that disappears uncleanly — crash, network drop, laptop
  // closed mid-session — leaves its transport (and session-id map
  // entry) resident forever in this long-running container.
  const sessionIdleTimeoutMs =
    Number.parseInt(process.env.MCP_SESSION_IDLE_TIMEOUT_MS ?? "", 10) ||
    3_600_000;

  return {
    plexUrl: plexUrl!,
    plexToken: plexToken!,
    port,
    allowedHosts,
    allowedOrigins,
    sessionIdleTimeoutMs,
    tautulli: resolveTautulliConfig(),
  };
}

export const config = loadConfig();
