// Tests for OAuth 2.1 protected-resource auth (Phase 2 — see
// docs/CHATGPT-APPS-SDK.md and src/auth.ts). Per that doc's own plan:
// "mock JWKS, don't hit a real IdP" — this is a well-defined
// cryptographic contract, not Plex business logic, so a locally
// generated keypair plus a real local HTTP server serving real OIDC
// discovery/JWKS documents is the right level of "real" here. jose's
// actual verification code runs for real against real signatures; only
// the IdP itself is a local stand-in (no live Auth0/Logto tenant
// exists yet — that's Phase 3).

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  type JWK,
  type KeyLike,
} from "jose";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  createAuthMiddleware,
  loadAuthConfig,
  protectedResourceMetadata,
  type AuthConfig,
} from "../src/auth.js";

const KID = "test-key-1";
const AUDIENCE = "https://plex-mcp.example.test";
const REQUIRED_SCOPES = ["plex:read"];

let idpServer: Server;
let idpUrl: string;
let privateKey: KeyLike;

beforeAll(async () => {
  const { publicKey, privateKey: priv } = await generateKeyPair("ES256");
  privateKey = priv;
  const publicJwk: JWK = await exportJWK(publicKey);
  publicJwk.kid = KID;
  publicJwk.alg = "ES256";
  publicJwk.use = "sig";

  const idpApp = express();
  idpApp.get("/.well-known/openid-configuration", (_req, res) => {
    res.json({ issuer: idpUrl, jwks_uri: `${idpUrl}/.well-known/jwks.json` });
  });
  idpApp.get("/.well-known/jwks.json", (_req, res) => {
    res.json({ keys: [publicJwk] });
  });

  idpServer = await new Promise((resolve) => {
    const s = idpApp.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = idpServer.address() as AddressInfo;
  idpUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => idpServer.close(() => resolve()));
});

function authConfig(): AuthConfig {
  return {
    issuer: idpUrl,
    audience: AUDIENCE,
    requiredScopes: REQUIRED_SCOPES,
  };
}

async function signToken(
  overrides: {
    scope?: string;
    aud?: string;
    iss?: string;
    exp?: number;
    nbf?: number;
    signWith?: KeyLike;
  } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  let builder = new SignJWT({ scope: overrides.scope ?? "plex:read" })
    .setProtectedHeader({ alg: "ES256", kid: KID })
    .setIssuedAt(now)
    .setIssuer(overrides.iss ?? idpUrl)
    .setAudience(overrides.aud ?? AUDIENCE)
    .setExpirationTime(overrides.exp ?? now + 300);
  if (overrides.nbf !== undefined) {
    builder = builder.setNotBefore(overrides.nbf);
  }
  return builder.sign(overrides.signWith ?? privateKey);
}

type Harness = { url: string; dispose: () => Promise<void> };

async function startTestApp(config: AuthConfig): Promise<Harness> {
  const app = express();
  app.get("/protected", createAuthMiddleware(config), (_req, res) => {
    res.json({ ok: true });
  });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/protected`,
    dispose: () =>
      new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("createAuthMiddleware", () => {
  let harness: Harness | undefined;

  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });

  test("missing Authorization header -> 401 with WWW-Authenticate", async () => {
    harness = await startTestApp(authConfig());
    const res = await fetch(harness.url);
    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get("www-authenticate");
    expect(wwwAuth).toContain(
      `resource_metadata="${AUDIENCE}/.well-known/oauth-protected-resource"`,
    );
    expect(wwwAuth).toContain('scope="plex:read"');
  });

  test("non-Bearer Authorization header -> 401", async () => {
    harness = await startTestApp(authConfig());
    const res = await fetch(harness.url, {
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.status).toBe(401);
  });

  test("valid token with required scope -> passes through", async () => {
    harness = await startTestApp(authConfig());
    const token = await signToken();
    const res = await fetch(harness.url, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("wrong audience -> 401", async () => {
    harness = await startTestApp(authConfig());
    const token = await signToken({ aud: "https://someone-else.example" });
    const res = await fetch(harness.url, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  test("wrong issuer -> 401", async () => {
    harness = await startTestApp(authConfig());
    const token = await signToken({
      iss: "https://not-the-real-idp.example",
    });
    const res = await fetch(harness.url, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  test("expired token -> 401", async () => {
    harness = await startTestApp(authConfig());
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken({ exp: now - 60 });
    const res = await fetch(harness.url, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  test("not-yet-valid token (nbf in the future) -> 401", async () => {
    harness = await startTestApp(authConfig());
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken({ nbf: now + 3600 });
    const res = await fetch(harness.url, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  test("valid token missing the required scope -> 403", async () => {
    harness = await startTestApp(authConfig());
    const token = await signToken({ scope: "plex:write" });
    const res = await fetch(harness.url, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  test("token signed by a different key -> 401 (bad signature)", async () => {
    harness = await startTestApp(authConfig());
    const { privateKey: otherKey } = await generateKeyPair("ES256");
    const token = await signToken({ signWith: otherKey });
    const res = await fetch(harness.url, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });
});

describe("loadAuthConfig", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  test("returns null when MCP_OAUTH_ISSUER is unset", () => {
    delete process.env.MCP_OAUTH_ISSUER;
    expect(loadAuthConfig()).toBeNull();
  });

  test("exits when ISSUER is set but AUDIENCE is missing", () => {
    process.env.MCP_OAUTH_ISSUER = "https://idp.example.test";
    delete process.env.MCP_OAUTH_AUDIENCE;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    }) as unknown as (code?: number) => never;
    expect(() => loadAuthConfig()).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("defaults requiredScopes to plex:read", () => {
    process.env.MCP_OAUTH_ISSUER = "https://idp.example.test";
    process.env.MCP_OAUTH_AUDIENCE = "https://plex-mcp.example.test";
    delete process.env.MCP_OAUTH_REQUIRED_SCOPES;
    expect(loadAuthConfig()?.requiredScopes).toEqual(["plex:read"]);
  });

  test("parses comma-separated MCP_OAUTH_REQUIRED_SCOPES", () => {
    process.env.MCP_OAUTH_ISSUER = "https://idp.example.test";
    process.env.MCP_OAUTH_AUDIENCE = "https://plex-mcp.example.test";
    process.env.MCP_OAUTH_REQUIRED_SCOPES = "plex:read, plex:write";
    expect(loadAuthConfig()?.requiredScopes).toEqual([
      "plex:read",
      "plex:write",
    ]);
  });
});

describe("protectedResourceMetadata", () => {
  test("returns the RFC 9728 shape", () => {
    expect(protectedResourceMetadata(authConfig())).toEqual({
      resource: AUDIENCE,
      authorization_servers: [idpUrl],
      scopes_supported: REQUIRED_SCOPES,
      resource_documentation: "https://github.com/CarlDog/plex-mcp",
    });
  });
});
