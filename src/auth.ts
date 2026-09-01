// OAuth 2.1 protected-resource auth for the /mcp endpoint (ChatGPT Apps
// SDK alignment, Phase 2 — see docs/CHATGPT-APPS-SDK.md). Opt-in: unset
// MCP_OAUTH_ISSUER and the server behaves exactly as before (no auth) —
// same pattern as MCP_TLS in src/tls.ts.
//
// Validates a bearer JWT against the issuer's JWKS, resolved via OIDC
// discovery and cached by jose's createRemoteJWKSet (which already
// handles refresh-on-kid-miss internally — no need to hand-roll that).
// jose's jwtVerify natively checks iss/aud/exp/nbf; this module adds the
// required-scope check and the MCP Authorization spec's (2025-06-18)
// WWW-Authenticate + RFC 9728 protected-resource-metadata plumbing on
// top.
//
// No live IdP has been provisioned yet (that's Phase 3) — this has been
// verified against a locally-generated keypair/JWKS (tests/auth.test.ts),
// not a real Auth0/Logto tenant. The OIDC discovery URL is built per the
// OIDC Discovery 1.0 spec (issuer's path, if any, is preserved and
// `/.well-known/openid-configuration` is appended after it — NOT
// `new URL("/.well-known/...", issuer)`, which would incorrectly replace
// a multi-tenant issuer's path). Auth0 issuers are flat (no path), so
// this distinction is untested against a real path-based issuer.

import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { describeTransportError } from "./errors.js";
import { log } from "./log.js";

export interface AuthConfig {
  issuer: string;
  issuerUrl: URL;
  audience: string;
  requiredScopes: string[];
}

const DEFAULT_REQUIRED_SCOPES = "plex:read";

function loadIssuerUrl(issuer: string): URL {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    log.error("auth", "MCP_OAUTH_ISSUER must be a valid HTTPS URL");
    process.exit(1);
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    log.error(
      "auth",
      "MCP_OAUTH_ISSUER must be an HTTPS origin or path with no credentials, query, or fragment",
    );
    process.exit(1);
  }
  return url;
}

/**
 * Read MCP_OAUTH_* env vars. Returns `null` when MCP_OAUTH_ISSUER is
 * unset — the caller's signal that auth is off. If ISSUER is set but
 * AUDIENCE is missing, fails fast (log + exit) rather than silently
 * degrading to no-auth or starting in a half-configured state — matches
 * src/config.ts's MCP_ALLOWED_HOSTS precedent for a required HTTP-mode
 * var, and src/tls.ts's loadByoCredentials for "opted in but
 * incomplete."
 */
export function loadAuthConfig(): AuthConfig | null {
  const issuer = process.env.MCP_OAUTH_ISSUER;
  if (!issuer) return null;

  const issuerUrl = loadIssuerUrl(issuer);
  const audience = process.env.MCP_OAUTH_AUDIENCE;
  if (!audience) {
    log.error(
      "auth",
      "MCP_OAUTH_AUDIENCE is required when MCP_OAUTH_ISSUER is set (RFC 8707 audience binding) — set it to this server's canonical resource URI, e.g. https://plex-mcp.example.com",
    );
    process.exit(1);
  }

  const requiredScopes = (
    process.env.MCP_OAUTH_REQUIRED_SCOPES ?? DEFAULT_REQUIRED_SCOPES
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return { issuer, issuerUrl, audience, requiredScopes };
}

// Cache the resolved JWKS getter per issuer. createRemoteJWKSet already
// caches individual keys (and refreshes on a kid it hasn't seen), so this
// only saves re-running OIDC discovery on every request.
let cachedJwks: { issuer: string; getKey: JWTVerifyGetKey } | undefined;

async function resolveJwks(issuer: URL): Promise<JWTVerifyGetKey> {
  const issuerString = issuer.toString();
  if (cachedJwks?.issuer === issuerString) return cachedJwks.getKey;

  // OIDC Discovery 1.0: append to the issuer's existing path (if any),
  // don't replace it — a multi-tenant IdP's issuer can carry a path
  // (e.g. https://idp.example.com/realm/foo).
  const discoveryUrl = new URL(
    `${issuerString.replace(/\/+$/, "")}/.well-known/openid-configuration`,
  );
  let res: globalThis.Response;
  try {
    res = await fetch(discoveryUrl);
  } catch (err) {
    throw new Error(
      `OIDC discovery failed for ${issuerString}: ${describeTransportError(err)}`,
      { cause: err },
    );
  }
  if (!res.ok) {
    throw new Error(
      `OIDC discovery failed for ${issuerString}: ${res.status} ${res.statusText}`,
    );
  }
  const doc = (await res.json()) as { jwks_uri?: string };
  if (!doc.jwks_uri) {
    throw new Error(
      `OIDC discovery document for ${issuerString} has no jwks_uri`,
    );
  }
  const jwksUrl = new URL(doc.jwks_uri);
  if (jwksUrl.origin !== issuer.origin) {
    throw new Error(
      `OIDC discovery document for ${issuerString} returned a cross-origin jwks_uri`,
    );
  }
  const getKey = createRemoteJWKSet(jwksUrl);
  cachedJwks = { issuer: issuerString, getKey };
  return getKey;
}

function wwwAuthenticateHeader(config: AuthConfig): string {
  const metadataUrl = `${config.audience}/.well-known/oauth-protected-resource`;
  const scope = config.requiredScopes.join(" ");
  return `Bearer resource_metadata="${metadataUrl}", scope="${scope}"`;
}

function sendUnauthorized(res: Response, config: AuthConfig): void {
  res.setHeader("WWW-Authenticate", wwwAuthenticateHeader(config));
  res.status(401).json({
    jsonrpc: "2.0",
    error: {
      code: -32001,
      message: "Unauthorized: missing or invalid bearer token",
    },
    id: null,
  });
}

function sendForbidden(res: Response, missingScopes: string[]): void {
  res.status(403).json({
    jsonrpc: "2.0",
    error: {
      code: -32001,
      message: `Forbidden: missing required scope(s): ${missingScopes.join(", ")}`,
    },
    id: null,
  });
}

/**
 * Express middleware validating the request's bearer JWT against
 * `config`. Meant to run after the existing Host/Origin allowlist check
 * (src/mcp-route.ts's checkHostAndOrigin) — that's the cheaper,
 * no-crypto-needed defense and should reject a spoofed Host before this
 * does any JWKS work.
 */
export function createAuthMiddleware(config: AuthConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) {
      sendUnauthorized(res, config);
      return;
    }

    let scopeClaim: unknown;
    try {
      const getKey = await resolveJwks(config.issuerUrl);
      const { payload } = await jwtVerify(token, getKey, {
        issuer: config.issuer,
        audience: config.audience,
      });
      scopeClaim = payload.scope;
    } catch (err) {
      log.warn("auth", "token rejected", { msg: (err as Error).message });
      sendUnauthorized(res, config);
      return;
    }

    // Standard OAuth2 access-token convention (Auth0 included): `scope`
    // is a single space-delimited string, not an array.
    const grantedScopes =
      typeof scopeClaim === "string" ? scopeClaim.split(" ") : [];
    const missing = config.requiredScopes.filter(
      (s) => !grantedScopes.includes(s),
    );
    if (missing.length > 0) {
      log.warn("auth", "token missing required scope", { missing });
      sendForbidden(res, missing);
      return;
    }

    next();
  };
}

/**
 * The RFC 9728 protected-resource metadata document. Only meaningful
 * (and only mounted by src/index.ts) when auth is configured — with no
 * issuer, there's nothing accurate to report.
 */
export function protectedResourceMetadata(
  config: AuthConfig,
): Record<string, unknown> {
  return {
    resource: config.audience,
    authorization_servers: [config.issuer],
    scopes_supported: config.requiredScopes,
    resource_documentation: "https://github.com/CarlDog/plex-mcp",
  };
}
