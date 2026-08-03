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

### Changed

- Dev/CI chain modernized: ESLint 10, Prettier 3.9, `@modelcontextprotocol/sdk`
  1.30, vitest 4, Node 22-alpine → 26-alpine base image, the fleet's
  canonical Dependabot config.
- README documents `HOST_IMAGE_DIR` as **required** for Portainer
  git-stack deploys: the relative compose default (`./data/images`)
  resolves inside the per-commit clone directory, Docker refuses the
  bind mount, and the container lands stuck in `created` without
  starting (took the deployed stack down ~10h on 2026-07-31).

### Fixed

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
  previously leaked its transport forever.

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
