# ChatGPT Apps SDK alignment — future work

What it would take to make plex-mcp consumable from a ChatGPT
account in [developer mode][apps-sdk]. Captured as a spec so the
work can be picked up cold later. Not started — no code yet.

[apps-sdk]: https://developers.openai.com/apps-sdk

## TL;DR

ChatGPT's MCP Apps SDK requires three things that stock plex-mcp
doesn't have:

1. **Internet-reachable HTTPS endpoint.** plex-mcp must be callable
   from `chatgpt.com`, not just LAN.
2. **OAuth 2.1 protected-resource setup.** ChatGPT cannot present
   API keys, mTLS, or use client_credentials — only OAuth 2.1
   authorization-code+PKCE with a bearer token attached as
   `Authorization: Bearer <jwt>`.
3. **Tool annotation hints.** Cheap behavioral win — flag
   `readOnlyHint` / `destructiveHint` / `openWorldHint` per the
   Apps SDK metadata guidelines.

UI widgets (React components served as `text/html;profile=mcp-app`
resources) are *optional but high-value* for media-library UX. Out
of scope for the initial alignment pass; track as a v0.9 / v1.0
candidate once the auth pieces are in.

## Why this is bigger than "add auth"

plex-mcp today binds to private networks (per CLAUDE.md's
"Transport modes" section). ChatGPT's OAuth flow involves the
*user's browser*, *ChatGPT's backend*, and *the IdP and resource
server* — both the resource server (plex-mcp) and the authorization
server need public HTTPS endpoints. A purely LAN-local deployment
can never be the target of a ChatGPT connector. This is the actual
architectural shift; OAuth code in the express middleware is the
smaller piece.

## Spec sources

Read these before starting:

- [Apps SDK auth][auth-docs] — ChatGPT-specific OAuth contract,
  redirect URI, CIMD vs DCR.
- [MCP Authorization spec (2025-06-18)][mcp-auth] — the formal
  resource-server contract: WWW-Authenticate, RFC 9728
  protected-resource metadata, audience binding via RFC 8707,
  PKCE required.
- [Apps SDK metadata guide][optimize-metadata] — annotation hints
  (`readOnlyHint`, `destructiveHint`, `openWorldHint`) and the
  "Use this when…" description style.
- [Apps SDK MCP server overview][mcp-overview].

[auth-docs]: https://developers.openai.com/apps-sdk/build/auth
[mcp-auth]: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
[optimize-metadata]: https://developers.openai.com/apps-sdk/guides/optimize-metadata
[mcp-overview]: https://developers.openai.com/apps-sdk/build/mcp-server

## What plex-mcp itself must implement

The code-side gap. All of this is additive — no existing tool
contract changes.

### 1. Express middleware: bearer-token validation

Sits in front of the `/mcp` handler in `src/index.ts`. Skips
`/health` and the metadata endpoint below.

For each `/mcp` request:

1. Read `Authorization` header. If missing or not `Bearer …` →
   return 401 with the WWW-Authenticate header (see step 2).
2. Validate the JWT:
   - Signature via `jose` against the IdP's JWKS (cached, refreshed
     on `kid` miss).
   - `iss` matches `MCP_OAUTH_ISSUER` env.
   - `aud` includes our canonical resource URI from
     `MCP_OAUTH_RESOURCE` env (RFC 8707 audience binding —
     mandatory per the MCP spec).
   - `exp` not in the past, `nbf` not in the future.
   - Required scopes present (initial scope: `plex:read`; could
     split read vs write later).
3. On invalid → 401 with WWW-Authenticate. On valid but missing
   scope → 403. On valid → pass through.

Dep: `jose` (~ 80 KB, zero runtime deps, modern JWT/JWKS library).

### 2. `WWW-Authenticate` response header

Exact format on 401:

```
WWW-Authenticate: Bearer resource_metadata="https://<host>/.well-known/oauth-protected-resource", scope="plex:read"
```

### 3. `/.well-known/oauth-protected-resource` route (RFC 9728)

Public, no auth. Returns:

```json
{
  "resource": "https://<host>",
  "authorization_servers": ["https://<idp-issuer>"],
  "scopes_supported": ["plex:read", "plex:write"],
  "resource_documentation": "https://github.com/CarlDog/plex-mcp"
}
```

`resource` must be the **canonical URI without trailing slash**
per the MCP spec.

### 4. Configuration surface (env vars)

| Var | Notes |
| --- | --- |
| `MCP_OAUTH_ISSUER` | IdP issuer URL. Used to fetch `.well-known/openid-configuration` and JWKS. Setting this opts in to auth. |
| `MCP_OAUTH_AUDIENCE` | Expected `aud` claim. Should equal the canonical resource URI. |
| `MCP_OAUTH_REQUIRED_SCOPES` | Comma-separated. Default `plex:read`. |
| `MCP_OAUTH_ALLOW_HEALTH_ANONYMOUS` | Default `true` — keep `/health` accessible for the Docker healthcheck. |

When `MCP_OAUTH_ISSUER` is unset, the server stays on today's
no-auth behavior (so the existing LAN deployment is unaffected).
Auth is opt-in, parallel to how HTTPS is opt-in.

### 5. Tool annotation pass (independent of auth, do anytime)

Per [optimize-metadata][optimize-metadata]:

| Tool category | `readOnlyHint` | `destructiveHint` | `openWorldHint` |
| --- | --- | --- | --- |
| All search/list/get/browse/history/hubs/related/similar/get_matches | `true` | n/a | `false` |
| mark_watched, mark_unwatched | `false` | `false` | `false` |
| Playlist add/create/remove | `false` | `false` | `false` |
| edit_metadata, refresh_metadata, refresh_section, apply_match, unmatch, split_item, merge_items | `false` | `false` | `false` |
| **delete_playlist** | `false` | **`true`** | `false` |

Mechanical edit across `src/tools/*.ts`. Also a polish pass on
descriptions: lead each with `"Use this when…"` and call out
disallowed cases.

## Infrastructure outside plex-mcp

### Internet exposure

**Recommendation: Cloudflare Tunnel** (`cloudflared` container in
Portainer). Fits the existing homelab pattern: one more service in
the stack, no port-forwards, free, terminates TLS at Cloudflare
edge. Maps `plex-mcp.<your-domain>` to the LAN address.

Alternatives considered:
- Tailscale Funnel — works, but ChatGPT runs in the cloud, not on
  a Tailscale-joined client, so the tunnel has to be "public" mode
  which has the same exposure profile as Cloudflare.
- Port-forward + DDNS + Let's Encrypt — works but requires NAT
  rules and exposes the NAS IP. No upside over Cloudflare Tunnel.

### Authorization server choice

| | Self-hosted (Logto / Zitadel) | Hosted (Auth0 free tier) |
| --- | --- | --- |
| Fits all-self-hosted homelab pattern | ✅ | ❌ external dependency |
| Setup time for one user | longer — Docker stack, DB, public tunnel | shorter — signup + app config |
| Validated by OpenAI in Apps SDK docs | unverified | yes, referenced |
| DCR + PKCE + RFC 8707 resource indicators | both support | yes |
| Ongoing ops burden | container + Postgres + updates | none |
| Free for 1 user | yes | yes (7500 MAU) |

**Current recommendation: Auth0** for the initial pass.
Self-hosted purity loss is small — Auth0 only handles the login
dance, never touches Plex data. Plex token + library content stay
on the NAS. The middleware code in plex-mcp is identical either
way (it just reads env), so swapping to Logto later is a one-day
migration.

### ChatGPT-side configuration

- Redirect URI to pre-register at the IdP:
  `https://chatgpt.com/connector/oauth/{callback_id}` (the
  `callback_id` is shown in the ChatGPT app-management page after
  the connector is created).
- Legacy redirect (still accepted):
  `https://chatgpt.com/connector_platform_oauth_redirect`.
- Either pre-register ChatGPT as a static client, use DCR (RFC
  7591) if the IdP supports it, or use CIMD (Client ID Metadata
  Documents) for trust-on-first-use registration. CIMD is the
  cleanest if the IdP supports it; Auth0 does not currently.

## Phased plan

Each phase is a self-contained chunk that can ship independently.
Order is not strict — phase 1 is the lowest-cost win even without
the rest.

### Phase 1: tool annotations (no infra, ~half day)

- Add `readOnlyHint` / `destructiveHint` / `openWorldHint` to
  every tool registration per the table above.
- Polish descriptions to lead with `"Use this when…"`.
- No infra change; benefits stock MCP clients too.

### Phase 2: code-side auth (no infra, ~half day)

- Add `src/auth.ts` — JWT verification middleware + JWKS cache.
- Add `/.well-known/oauth-protected-resource` route in
  `src/index.ts`.
- Add 401 + WWW-Authenticate path.
- Env-var driven; default off (no `MCP_OAUTH_ISSUER` = no-op).
- Tests: token-with-wrong-aud → 401, expired token → 401, valid
  token → pass-through, missing scope → 403. Mock JWKS, don't
  hit a real IdP.

### Phase 3: infrastructure (~one evening)

- Stand up Cloudflare Tunnel container in Portainer.
- Register a public hostname for plex-mcp.
- Provision Auth0 tenant (or Logto if going self-hosted).
- Configure a Regular Web Application client; add ChatGPT redirect
  URI; configure scopes (`plex:read` initially).

### Phase 4: end-to-end with ChatGPT developer mode (~one evening)

- Create the connector in ChatGPT developer mode pointing at the
  public plex-mcp URL.
- Walk the OAuth flow once; verify token is received and validated.
- Smoke a few tool calls.
- Document gotchas back into this file.

### Phase 5 (optional, much later): UI widgets

React components bundled as a single JS module, served as resources
at `ui://widget/<name>.html` with MIME `text/html;profile=mcp-app`.
Tools attach `_meta.openai/outputTemplate` referencing the URI.
Tool responses split into `structuredContent` (data) +
`content` (text fallback). Natural candidates:

- Poster grid for `plex_browse` / `plex_search` results.
- Now-playing card for `plex_now_playing`.
- Track list for `plex_get_playlist_items`.

Defer until phases 1–4 are in production use.

## Open decisions (pick at start)

- **IdP:** Auth0 hosted (default) vs Logto self-hosted vs Zitadel
  self-hosted. Default is Auth0 unless self-hosted purity is
  reasserted.
- **Public hostname:** existing domain or a new one? Cloudflare
  Tunnel works either way.
- **Scope granularity:** start with `plex:read` only and add
  `plex:write` later when comfortable, OR ship both immediately
  and let ChatGPT request both at consent time. Default: read-only
  first, see what breaks.
- **Backwards compat:** keep no-auth mode for LAN-local clients
  indefinitely (env-var-gated) or sunset it once OAuth is live?
  Default: keep it forever — costs nothing and the LAN deployment
  is the development loop.

## Cost framing (honest)

Total: roughly a week of evening-time work, distributed across
4–5 sessions. Not an afternoon. Most of the cost is infrastructure
and ChatGPT-side fiddling, not the plex-mcp code itself.

The cheapest win that doesn't require any of the above is **Phase 1
alone** — tool annotations land in any stock MCP client and improve
behavior immediately. If the OAuth path stalls, Phase 1 is still
worth doing.
