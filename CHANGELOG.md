# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries through v0.7.1 are a backfill (standard UNI-12) reconstructed from
git history and STATUS.md; from here forward, update this file alongside
the work rather than after the fact.

## [Unreleased]

### Added

- Optional direct Tautulli integration with four read-only tools:
  `plex_tautulli_status`, `plex_tautulli_activity`,
  `plex_tautulli_history`, and `plex_tautulli_watch_time`. The integration is
  disabled when `TAUTULLI_URL`/`TAUTULLI_API_KEY` are unset, never participates
  in `/health`, and normalizes responses through explicit allowlists so
  Tautulli email, IP, machine-id, and filesystem-path fields cannot escape.
- Portainer-overridable `TAUTULLI_URL`, `TAUTULLI_API_KEY`, and
  `TAUTULLI_TIMEOUT_MS` Compose variables under fleet standard MCP-E02.
- `plex_remove_from_continue_watching(rating_key)` — removes an item
  from the Continue Watching hub without touching its watch progress.
  Resolves a 2026-08-15 deferral: the real request (`PUT
  /actions/removeFromContinueWatching?ratingKey=...`) was found by
  capturing Plex Web's own network traffic, since the community OpenAPI
  spec documented the wrong query param (`key` instead of `ratingKey`).
- **Optional shared-secret bearer auth (`MCP_AUTH_TOKEN`) for `/mcp`.**
  This was the last fleet MCP server with zero auth capability beyond
  the Host/Origin allowlist. `MCP_AUTH_TOKEN` adds the same
  constant-time-compared bearer check every sibling server supports —
  checked after the Host/Origin allowlist and before the existing OAuth
  2.1 JWT flow (`MCP_OAUTH_*`), an independent, simpler layer for
  non-OAuth MCP clients. Unset (the current live-deployment state) logs
  a startup warning and leaves `/mcp` open to this particular check, same
  fail-soft default as every sibling server. `/health` stays unauthenticated
  (Docker's healthcheck can't supply a token).

### Changed

- **Rate-limited the HTTP MCP route before authentication and session
  allocation.** Each client IP receives 60 requests per 60-second window by
  default; excess requests return `429` with `Retry-After`. Expired entries are
  pruned by the existing unref'd session sweep, and
  `MCP_RATE_LIMIT_MAX_REQUESTS` provides a validated 1–600 operator override.
  This closes the unauthenticated-route request-flood finding without changing
  stdio transport behavior.

- **Hardened opt-in OAuth OIDC discovery against configuration-driven SSRF.**
  `MCP_OAUTH_ISSUER` must now be a clean HTTPS issuer URL with no credentials,
  query, or fragment, and OIDC discovery may only use a same-origin `jwks_uri`.
  JWT validation preserves the configured issuer string exactly; the new URL is
  used solely for outbound discovery. Covered by rejection tests for malformed
  issuers and a cross-origin JWKS discovery document. OAuth remains unset in the
  live deployment, so this does not require an operator configuration change.

- **`MCP_ALLOWED_HOSTS` matching is now hostname-only and port-independent,
  aligned with the rest of the fleet.** The Host allowlist previously
  required an exact `host:port` match (e.g. `nas.local:3001`), a holdover
  from before the fleet's shared allowlist convention existed (STATUS.md
  MCP-S01). A DNS-rebinding attacker's Host header port is pinned by the
  real TCP connection regardless — the allowlist defends hostnames, not
  ports — so the stricter match added no real protection while forcing a
  fleet-inconsistent value. Host matching now delegates to the
  fleet-canonical `src/shared/mcp-environment.ts` (`requestAuthorityAllowed`,
  the same module ported into kindroid-mcp/servarr-mcp/filesystem-mcp/
  portainer-mcp/mnemosyne-mcp/watch-companion/downloader-mcp this pass),
  called host-only so bracketed IPv6 like `[::1]` works while this repo's
  own separate `MCP_ALLOWED_ORIGINS` allowlist stays untouched. This also
  retires the `host:port`-tolerant back-compat this repo's earlier fix
  shipped the same day: `MCP_ALLOWED_HOSTS` is now validated strictly at
  startup — a `host:port` entry, scheme, or wildcard throws immediately
  with a clear message instead of being silently tolerated. The
  transition window is closed (the live deployment's env is already
  port-less canonical).
- **`MCP_SESSION_IDLE_TIMEOUT_MS` renamed to `MCP_SESSION_IDLE_MS`**
  (default 30 min, was 1 hr) to match every other fleet MCP server's name
  and default for the same idle-session-eviction concept.
- **Package renamed to `@carldog/plex-mcp`.** The unscoped name `plex-mcp`
  is owned by an unrelated package (`vyb1ng/plex-mcp`), so it was never
  available; a scope is reserved to the account, so no name inside it can be
  taken. Nothing is published to npm - this ships as a container - so the
  rename is invisible to consumers; `package-lock.json` was regenerated with
  it.

## [0.8.0] - 2026-08-28

### Added

- Opt-in HTTPS on the HTTP transport (`src/tls.ts`): self-managed ECDSA
  P-256 cert (`MCP_TLS=auto`) or a bring-your-own cert pair.
- `plex_get_image` / `plex_save_image` — fetch or disk-write Plex artwork
  (poster/art/banner/squareArt/clearLogo), with `/photo/:/transcode`
  resize support and a configurable size cap (`MCP_IMAGE_MAX_BYTES`).
- `minimal` / `fields` sparse projection on `plex_get_item`, mirroring the
  projection already shipped on `plex_browse`.
- MCP tool annotation hints (`readOnlyHint` / `destructiveHint` /
  `idempotentHint` / `openWorldHint`) on every tool — ChatGPT Apps SDK
  alignment Phase 1 (see `docs/CHATGPT-APPS-SDK.md`).
- MIT LICENSE.
- Fleet-standard CI hardening: `.editorconfig`, a standalone `gitleaks`
  secrets-scanning workflow, and a `test` gate in front of
  `docker-publish.yml` so a red `main` can no longer ship `:latest`.
- Non-networked regression tests: `tests/image-url-guard.test.ts`,
  `tests/image-max-bytes.test.ts`.
- `src/config.ts` (MCP-S01, partial): centralizes the env vars that were
  already read and validated eagerly at module-load time in
  `src/index.ts` — `PLEX_URL`, `PLEX_TOKEN`, `MCP_PORT`,
  `MCP_ALLOWED_HOSTS`, `MCP_ALLOWED_ORIGINS`,
  `MCP_SESSION_IDLE_TIMEOUT_MS` — into one module, preserving their
  exact validate-or-exit(1) behavior. Deliberately doesn't cover
  `src/tls.ts`'s vars (read lazily, only in HTTP+TLS mode — centralizing
  them would make an invalid `MCP_TLS_DAYS` fail stdio-mode startups it
  doesn't affect today) or `src/plex.ts`'s per-call vars (already behind
  tested pure `resolve*()` functions).
- `plex_list_collections`, `plex_hub_search`, and a `collection` filter
  on `plex_browse` — collections support. All endpoints verified against
  the real live Plex server (not just a deployed container) before
  shipping.
- Subtitle track discovery: `plex_get_item`'s `minimal=true` mode now
  keeps subtitle-type `Stream[]` entries (language, codec, the
  `hearingImpaired`/SDH flag) instead of dropping `Stream[]` entirely,
  while still dropping the audio/video entries that were the actual
  bulk of minimal mode's token savings.
- `plex_download_logs` — fetch Plex Media Server's own diagnostic log
  bundle (`GET /diagnostics/logs`) and save it to disk under
  `MCP_LOG_SAVE_DIR` (default `/data/logs/`), same disk-write pattern as
  `plex_save_image`. New `MCP_LOG_MAX_BYTES` (default 50 MiB) and
  `MCP_LOG_FETCH_TIMEOUT_MS` (default 2 min) env vars — a log bundle has
  a different size/latency profile than an image.
- `plex_list_posters`, `plex_set_poster`, `plex_upload_poster` — poster
  management, closing the write-side gap for artwork. Upload accepts
  either an external URL (Plex fetches server-side) or a local file
  under `MCP_IMAGE_SAVE_DIR` (the `plex_save_image` output convention),
  and auto-selects the new poster by default (`select=false` adds it
  without changing what's displayed, by restoring the previous
  selection afterward). Corrects an earlier speculative design
  (STATUS.md, 2026-05-11) that assumed upload and select were one call
  with a `select` flag — the real python-plexapi source shows them as
  separate operations, and live testing confirmed Plex auto-selects
  every freshly uploaded poster server-side regardless.
- `plex_rate_item` — set or clear an item's 0–10 user star rating
  (`PUT /:/rate`). Omitting `rating` clears it back to unrated.
- `plex_on_deck` accepts an optional `section_id` to scope the on-deck
  list to one library section (`GET /library/sections/{id}/onDeck`)
  instead of the whole server.
- Opt-in OAuth 2.1 protected-resource auth on the HTTP transport
  (`src/auth.ts`) — ChatGPT Apps SDK alignment Phase 2. Bearer-JWT
  validation via `jose` (JWKS resolved through OIDC discovery, cached
  and refreshed on `kid` miss), `401`+`WWW-Authenticate` on missing/
  invalid tokens, `403` on valid-but-missing-scope, and a
  `/.well-known/oauth-protected-resource` route per RFC 9728. Default
  off (`MCP_OAUTH_ISSUER` unset means identical behavior to before);
  see README's "OAuth 2.1 bearer-token auth" section for the env vars.
  Not yet practically usable — needs a real IdP (Phase 3, not started).

### Changed

- `plex_refresh_section`'s description now notes the async two-pass
  reconciliation caveat: after a bulk filesystem rename/move, a
  single refresh can leave the section partially reconciled (old
  `episodeFileId`s detached, new ones not yet re-attached), needing a
  second call once the first scan settles.
- Phase-end audit cleanup: extracted `resolveIntEnv` to deduplicate 4
  byte-identical env-parsing functions in `src/plex.ts`; extracted
  `assertSafeBasename`/`ensureSaveDir`/`writeBytesToPath` to deduplicate
  `saveImage`/`downloadLogs`'s traversal-guard and disk-write logic
  (also reorders both to validate the save directory before the network
  fetch, so a bad `MCP_*_SAVE_DIR` fails fast); extracted
  `assertImageEntryPoint` to deduplicate `plex_get_image`/
  `plex_save_image`'s argument validation; extracted `sendRequest` to
  deduplicate `request<T>`/`requestNoContent`'s shared fetch-and-error
  contract — the highest-leverage dedup of the batch, since every tool
  routes through one of these two methods; extracted `fetchCappedBinary`
  to deduplicate `fetchBinary`/`downloadLogs`'s two-stage byte-cap-check
  logic (content-length header, then actual decoded byte count) while
  keeping each call site's own same-origin check, headers, cap source,
  and default MIME type as options. Doc drift fixed: README's tool
  table and env-var docs, CLAUDE.md's file listing, a stale STATUS.md
  "Next" item.
- **Breaking (tool input shape):** `plex_delete_playlist`, `plex_split_item`,
  and `plex_merge_items` now require `confirm_title` /
  `confirm_into_title` matching the target's actual current title
  (MCP-P06) — see Security below. Existing callers must add the field.
- Dev/CI chain modernized: ESLint 10, Prettier 3.9, `@modelcontextprotocol/sdk`
  1.30, vitest 4, Node 22-alpine → 26-alpine base image, the fleet's
  canonical Dependabot config.
- README documents `HOST_IMAGE_DIR` as **required** for Portainer
  git-stack deploys: the relative compose default (`./data/images`)
  resolves inside the per-commit clone directory, Docker refuses the
  bind mount, and the container lands stuck in `created` without
  starting (took the deployed stack down ~10h on 2026-07-31).
- **`docker-compose.yml`: `HOST_IMAGE_DIR`/`HOST_LOG_DIR` changed from
  `${VAR:-./relative/default}` to `${VAR:?message}` (required, no
  fallback).** Closes the gap left by the doc-only fix above — the
  relative default was still live in compose, so a fresh clone or a
  reset stack could still hit the same stuck-in-`created` failure.
  `docker compose config` now fails fast with a clear message if
  either is unset, matching `MCP_ALLOWED_HOSTS`'s existing required-var
  syntax. README's Portainer section updated to describe the hard
  requirement.

### Fixed

- A session the server no longer knows now answers **HTTP 404, not 400**.
  Idle sessions are evicted by design, but the Streamable HTTP spec
  (2025-06-18, Session Management §3/§4) makes 404 the client's *only*
  defined signal to start a new session by re-initializing. Returning 400
  read as a generic protocol error, so a routine eviction presented to the
  client as a dead connection until it was restarted by hand — observed live
  on servarr-mcp, then found identically in six fleet servers.
- `MCP_SESSION_IDLE_TIMEOUT_MS` is now actually present in
  `docker-compose.yml`. `src/config.ts` read it all along, but it was absent
  from the `environment:` block — so it read as configurable and silently
  wasn't (`docker-deployments.md` §10). Now tunable from Portainer.
- The `/mcp` request handler moved out of the self-executing `src/index.ts`
  into `src/mcp-route.ts` (`mountMcpRoute`). `index.ts` starts a listener at
  module scope, so nothing in it could be imported by a test without booting
  a server — which is why the session-handling bug above had no regression
  test here. Behaviour-preserving: same JSON-RPC error envelopes, same
  auth-before-session ordering, same `MCP_ALLOWED_ORIGINS` handling and
  refusal to start without `MCP_ALLOWED_HOSTS`. Covered by
  `tests/mcp-route.test.ts`.
- `MCP_FETCH_TIMEOUT_MS`/`MCP_LOG_FETCH_TIMEOUT_MS` (and the two byte-cap
  vars) previously only guarded against a non-numeric value — `"-1"`
  reached `AbortSignal.timeout(-1)` and threw a raw Node `RangeError`
  mislabeled as a generic "network error", and `"0"` timed out every
  request immediately with no indication the env var was the cause.
  Non-positive values now fall back to the default, same as an invalid one.
- Fixed a persistently-failing (not flaky) test in `tests/plex.test.ts`
  whose skip-guard checked a nonexistent field (`librarySectionAgent`,
  which lives on the library section, never on an item) and the wrong
  unmatched-GUID prefix (`local://`, which never occurs — the real one
  is `tv.plex.agents.none://<ratingKey>`). Both bugs meant the guard
  never fired, so the test ran `unmatch()` against a fixture already
  sitting unmatched in production from a prior broken run; separately
  re-matched that show for real via `plex_get_matches`/`plex_apply_match`/
  `plex_refresh_metadata`.
- `docker-compose.yml` (MCP-E02): the `volumes:` host path was a hardcoded
  absolute NAS path with zero `${}` indirection, and `LOG_LEVEL` (already
  read by `src/log.ts`) was never set at all. Now `${HOST_IMAGE_DIR:-./data/images}`
  and `LOG_LEVEL: "${LOG_LEVEL:-info}"`, both Portainer-overridable without
  a compose edit.
- `MCP_IMAGE_MAX_BYTES=""` no longer silently disables the image size cap
  (empty string now normalizes to unset, same as a missing env var).
- `npm ci` lockfile desync from orphaned `@rolldown/binding-*` /
  `@emnapi/*` references, twice.
- Pre-commit PII scan now covers renamed/copied staged files
  (`--diff-filter=ACMR`, not just `AM`).
- Network-error messages now surface their real cause (MCP-F08).
  `sendRequest()`'s catch and `auth.ts`'s OIDC discovery both built their
  message from `err.message` only — on a real `fetch()` failure that's
  Node's generic `TypeError: fetch failed`, discarding the actual
  DNS/connection/TLS reason living in `error.cause`. The MCP SDK's own
  tool-error conversion reads `error.message` only too, so `cause` would
  be silently dropped a second time if not folded into the message
  itself. New `src/errors.ts` `describeTransportError()`, wired into
  both fetch call sites (`plex.ts`'s single chokepoint, `auth.ts`'s JWKS
  discovery). Found via a fleet-wide sweep prompted by a live incident
  in downloader-mcp.
- `docker-compose.yml`: added `network_mode: bridge`. The NAS's Docker
  default-address-pool was fully exhausted; this stack's dedicated
  per-project network (`plex-mcp_default`) was one of many
  single-container stacks each claiming a slice for a container that
  has no need for inter-container DNS (Plex is reached via `PLEX_URL`
  over `host.docker.internal`/LAN, not a container name). Port
  publishing (`${HOST_PORT:-3001}:3000`) and `extra_hosts`
  (`host.docker.internal:host-gateway`) both work unchanged under
  bridge mode.

### Security

- `plex_get_image` / `plex_save_image` reject protocol-relative
  `image_url` values (`//host/...`, `/\host/...`), which would otherwise
  resolve off-server and leak `X-Plex-Token` to an arbitrary host.
- A personal-domain email that had reached public commit history via a
  merge commit created outside the local pre-commit hook's reach was
  scrubbed from history.
- HTTP transport hardening (MCP-F03): `MCP_ALLOWED_HOSTS` (required) and
  `MCP_ALLOWED_ORIGINS` (optional) allowlist the `Host`/`Origin` headers
  accepted on `/mcp`, closing a DNS-rebinding gap — binding `0.0.0.0`
  inside a container isn't a real access boundary, so a page loaded in a
  LAN browser could otherwise rebind its own hostname to the container's
  IP and drive tools (including writes) as a confused deputy. Idle MCP
  sessions are now swept and closed after `MCP_SESSION_IDLE_TIMEOUT_MS`
  (default 1h) of inactivity, since a client that disappears uncleanly
  previously leaked its transport forever. To let a sibling MCP container
  on the same Docker host call `/mcp` too, add
  `host.docker.internal:<HOST_PORT>` to the stack's `MCP_ALLOWED_HOSTS`
  value explicitly — kept as a plain operator-set allowlist entry rather
  than templated into `docker-compose.yml`, since this is a security
  policy, not a harmless convenience default.
- Destructive-tool name confirmation (MCP-P06): `plex_delete_playlist`,
  `plex_split_item`, and `plex_merge_items` previously gated on an opaque
  ratingKey/id alone — a transposed digit would act on the wrong target
  with nothing to catch it. Each now requires `confirm_title` (or
  `confirm_into_title` for merge) matching the resolved target's actual
  current title, refusing with both titles quoted in the error otherwise.
  Unlike a bare `confirm: true` flag (advisory — an autonomous agent can
  always self-supply it), a wrong id resolves to a *different* item whose
  real title won't match what the caller expected.
- Redaction + log verbosity (MCP-P04/P05). `plex_now_playing` was
  returning each session's `Player.address` (LAN IP) and
  `Player.remotePublicAddress` (the viewer's real public IP) raw — both
  confirmed against a live capture, neither relevant to what's playing.
  Both are now redacted. `plex_history` carries no `Player` object at
  all (also confirmed live), so nothing to redact there. Separately,
  tool invocations previously logged full argument *values* at `info`
  — user content like `plex_search.query`, `plex_edit_metadata.fields.*`,
  and `plex_save_image.filename` landed in default-level container logs.
  `info` now logs only argument *keys*; full values moved to `debug`.
- Fetch timeout + bounded 429 retry (MCP-F01/F02). All three outbound
  Plex requests (`request`, `requestNoContent`, `fetchBinary`) now route
  through a shared `fetchWithTimeoutAndRetry()` chokepoint in
  `src/plex.ts`: every call carries an `AbortSignal.timeout()`
  (`MCP_FETCH_TIMEOUT_MS`, default 30s) so a hung or half-open Plex
  server can't block a tool call indefinitely, and a `429` is retried up
  to twice honoring `Retry-After` — bounded to 30s so a large header
  value can't stall the request queue, giving up and surfacing the 429
  as an error instead.

## [0.7.1] - 2026-05-17

### Fixed

- GHCR publish backfill. The v0.7.0 tag's `docker-publish` build had
  failed silently: the lockfile had orphaned `@rolldown/binding-*`
  references declaring nested `@emnapi/core`/`@emnapi/runtime` deps
  without resolved `node_modules` entries — `npm install` tolerated it,
  `npm ci` (what CI uses) rejected it. Regenerated the lockfile from
  scratch.

## [0.7.0] - 2026-05-17

### Added

- `plex_split_item` / `plex_merge_items` — Plex's "Split Apart" and
  "Merge" catalog operations, for undoing an incorrect auto-merge or
  cleaning up duplicate releases.
- Opt-in HTTPS on the HTTP transport (self-managed + bring-your-own
  cert modes).
- `docs/CHATGPT-APPS-SDK.md` — future-work spec for ChatGPT Apps SDK
  alignment (OAuth 2.1, tool annotations, optional UI widgets).

## [0.6.0] - 2026-05-11

### Added

- `plex_edit_metadata` — scalar metadata field overrides (title,
  summary, year, etc.) with `.locked=1` by default so a later agent
  refresh doesn't wipe the override.
- `plex_unmatch` — detach an item from its agent binding back to
  `tv.plex.agents.none`.
- `plex_refresh_section` — section-level rescan, optional deep refresh.
- Sparse `fields` projection on `plex_browse`.

## [0.5.0] - 2026-05-11

### Added

- `plex_refresh_metadata`, `plex_get_matches`, `plex_apply_match` — the
  fix-an-unmatched-item flow (`get_matches` → pick a candidate →
  `apply_match` → optional `refresh_metadata`).

## [0.4.0] - 2026-04-29

### Added

- `plex_hubs`, `plex_section_hubs`, `plex_related`, `plex_similar` —
  curated-discovery tools.
- Structured stderr logging (`src/log.ts`), gated by `LOG_LEVEL`, with
  invoke/ok/error timing on every tool call.

## [0.3.0] - 2026-04-29

### Added

- Playlist CRUD: `plex_list_playlists`, `plex_get_playlist_items`,
  `plex_create_playlist`, `plex_add_to_playlist`,
  `plex_remove_from_playlist`, `plex_delete_playlist`.

### Changed

- Tool registrations refactored out of `src/index.ts` into
  `src/tools/`, one module per domain.

## [0.2.0] - 2026-04-29

### Added

- `plex_browse`, `plex_get_children`, `plex_now_playing`,
  `plex_history`, `plex_mark_watched`, `plex_mark_unwatched`.
- vitest integration test suite against a live Plex server, gated on
  `PLEX_URL` / `PLEX_TOKEN` so CI without secrets passes cleanly.

## [0.1.0] - 2026-04-28

### Added

- Initial release: TypeScript MCP server for Plex Media Server.
- Five read-only tools: `plex_list_libraries`, `plex_search`,
  `plex_recently_added`, `plex_on_deck`, `plex_get_item`.
- Dual transport (stdio default, Streamable HTTP via `MCP_PORT`),
  multi-stage Dockerfile, GHCR publish + multi-OS test matrix CI.
