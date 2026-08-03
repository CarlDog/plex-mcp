# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries through v0.7.1 are a backfill (standard UNI-12) reconstructed from
git history and STATUS.md; from here forward, update this file alongside
the work rather than after the fact.

## [Unreleased]

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

### Fixed

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
