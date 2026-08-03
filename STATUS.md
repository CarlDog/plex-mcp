# Status

**Last updated:** 2026-08-03 (MCP-S01 closed — `src/config.ts` added for
the eagerly-validated startup vars; full `src/shared/` template match
declined with reasoning on record. **Fleet standards-audit issue #8 is
now fully closed** — every item fixed or explicitly declined. Also this
session: MCP-F01/F02 (fetch timeout + bounded retry), MCP-P04/P05
(viewer-IP redaction + log verbosity), MCP-P06 (destructive-tool name
confirmation), MCP-F03 (HTTP transport hardening, verified live), UNI-16
closed as a non-issue. See "Done" below.)

## Phase

Deployed and verified — running on the NAS at
`http://your-nas:3001/mcp`. HTTP transport pilot for the `*-mcp`
family was proved end-to-end against a real Plex (14 libraries returned
via `plex_list_libraries`), then replicated to servarr-mcp and
downloader-mcp.

## Done

- Repo initialized with TypeScript + MCP SDK + Plex HTTP client skeleton
- Five read-only tools defined: `plex_list_libraries`, `plex_search`,
  `plex_recently_added`, `plex_on_deck`, `plex_get_item`
- Multi-stage Dockerfile (alpine, non-root user)
- Security baseline: `.gitignore`, `.gitleaks.toml`, `.githooks/pre-commit`
- Project docs: CLAUDE.md, STATUS.md, README.md
- `npm install` + `tsc` clean. `@modelcontextprotocol/sdk` resolved to
  v1.29.0; dist outputs verified. 0 vulnerabilities.
- Public repo published at https://github.com/CarlDog/plex-mcp with a
  no-PII commit author (CarlDog noreply).
- Serena project activated; five memories written
  (`project_overview`, `structure`, `suggested_commands`, `conventions`,
  `task_completion`). `.serena/` committed.
- OpenChronicle MCP server registered local-scope for this directory
  (`claude mcp add openchronicle -- oc mcp serve`).
- **Dual transport:** stdio (default) + Streamable HTTP (when `MCP_PORT`
  set). Per-session McpServer factory; `/mcp` endpoint with session-id
  header; `/health` for docker healthcheck. Express dependency added.
- **Compose deploy:** `docker-compose.yml` with HTTP transport on port
  `${HOST_PORT:-3001}:3000`, env passthrough for `PLEX_URL`/`PLEX_TOKEN`,
  healthcheck via wget.
- **CI:** GitHub Actions workflows — GHCR multi-arch image publish and
  a multi-OS test matrix; `lint` and `format:check` enforced as part of
  the test workflow.
- **Lint/format tooling:** ESLint + Prettier configured; VS Code
  workspace settings committed for consistent editor behavior.
- **Same-host Plex reachability fix:** `extra_hosts:
  ["host.docker.internal:host-gateway"]` added to
  `docker-compose.yml`; recommended `PLEX_URL=http://host.docker.internal:32400`
  documented in README. A container can't resolve the host machine's
  own hostname, so the previous `PLEX_URL=http://your-nas:32400`
  failed at fetch time inside the container.
- **Wired into Claude Desktop** via `mcp-remote` bridge
  (`npx -y mcp-remote http://your-nas:3001/mcp --allow-http`).
  End-to-end verified through the assistant: 14 libraries returned.
- **v0.2 shipped: 6 new tools (5 → 11 total).** Reads:
  `plex_browse` (paged section listing, optional type filter),
  `plex_get_children` (drill into shows/seasons/artists/albums),
  `plex_now_playing`, `plex_history` (paged, viewedAt:desc).
  Writes: `plex_mark_watched`, `plex_mark_unwatched` (reversible,
  trivially undone). Delete operations explicitly out of scope.
  Pagination uses `X-Plex-Container-Start`/`Size` as headers (Plex
  ignores Size alone — both must be present together; codified in
  `PlexClient` defaults).
- **Repo line-ending hygiene:** added `.gitattributes` enforcing LF,
  so prettier `endOfLine: "lf"` doesn't fail on Windows working trees
  with autocrlf.
- **Automated test suite (v0.2.5).** vitest + 13 integration tests
  against a live Plex (one per `PlexClient` method, plus regression
  tests for the `X-Plex-Container-Start/Size` pairing bug and a
  round-trip on `mark_watched`/`mark_unwatched`). Fixtures discovered
  dynamically at bootstrap so the suite survives a Plex DB rebuild.
  Env-gated: skipped when `PLEX_URL`/`PLEX_TOKEN` aren't set, so CI
  passes without secrets. Wired into the existing test workflow.
- **`src/tools/` refactor.** Tool registrations split out of
  `src/index.ts` into per-domain modules: `discovery.ts`,
  `sessions.ts`, `playback.ts`, `playlists.ts`, plus `helpers.ts`
  for shared utilities. `index.ts` shrunk from ~290 lines to ~110
  (env, transport, lifecycle only). Mechanical, no behavior change;
  tests passed before/after.
- **v0.3 shipped: 6 new playlist tools (11 → 17 total).** Reads:
  `plex_list_playlists`, `plex_get_playlist_items`. Writes:
  `plex_create_playlist`, `plex_add_to_playlist`,
  `plex_remove_from_playlist`, `plex_delete_playlist`. Smart
  playlists visible via list but not mutated (filter-expression
  shape out of scope). Test coverage: full CRUD round-trip
  (create → list → get items → add → remove → delete) plus
  standalone `getMachineIdentifier` / `metadataUri` checks.
  PlexClient gained HTTP-method support on `request` /
  `requestNoContent` to handle POST/PUT/DELETE.
- **v0.4 shipped: 4 new curated-discovery tools (17 → 21 total).**
  `plex_hubs`, `plex_section_hubs`, `plex_related`, `plex_similar`.
  Update-timeline tool deliberately scoped out (low value vs. the
  scrobble surface we already have).
- **Structured logging (v0.4).** `src/log.ts` writes to stderr in
  the format `<ts> <LEVEL> [<scope>] <msg> key=value...`, gated by
  `LOG_LEVEL` (default `info`). Tool layer logs invoke/ok/error
  with timing via a `withLogging` wrapper around every handler.
  PlexClient layer logs every HTTP request with method/path/status/ms
  at debug level (warn on 4xx, error on 5xx/network). Docker
  `logging:` block in compose caps log size at ~30MB with automatic
  rotation.

- **v0.5 shipped: 3 new admin tools (21 → 24 total).**
  `plex_refresh_metadata` (PUT `/library/metadata/{key}/refresh`,
  optional `force=1`), `plex_get_matches` (GET `/.../matches?manual=1`
  with title/year/agent/language overrides), `plex_apply_match` (PUT
  `/.../match?guid=&name=`). New `src/tools/admin.ts` module wired via
  `registerAdminTools`. The fix-unmatched-item flow:
  `plex_get_matches` → pick the right SearchResult → `plex_apply_match`
  → optional `plex_refresh_metadata` to pull poster/summary. Tests:
  refresh + getMatches read-paths covered; applyMatch round-trips by
  re-applying the item's current GUID back to itself (skipped when the
  fixture is on `tv.plex.agents.none`). Originally surfaced when a
  Plex audit session found 19 movies still bearing raw torrent
  filenames as titles because they were bound to the `agents.none`
  agent — files on disk were correctly named with `{imdb-tt...}` IDs,
  but Plex never re-matched.
- **v0.6 shipped: 3 new admin tools + 1 existing-tool enhancement
  (24 → 27 total).** All four highest-priority items from the
  2026-05-08 audit's v0.6 wishlist.
  - `plex_edit_metadata` (PUT `/library/metadata/{key}` with
    `<field>.value=` + `<field>.locked=`) — scalar field overrides
    for `title`, `title_sort`, `summary`, `year`,
    `originally_available_at`, `content_rating`, `studio`, `tagline`.
    `lock=true` is the default; without it any refresh wipes the
    override. snake_case ↔ camelCase translation handled in the
    tool layer. Unblocks the audit's outstanding MitB 2025 (rk
    207133) and Backlash Tampa (rk 208543) title fixes.
  - `plex_unmatch` (PUT `/library/metadata/{key}/unmatch`) — detach
    item from agent binding back to `agents.none`. Recovery flow is
    the same as fixing any agents.none item. Locked field values
    survive across unmatch.
  - `plex_refresh_section` (GET `/library/sections/{id}/refresh`,
    optional `force=1`) — section-level rescan, async on the
    server. Complements per-item `plex_refresh_metadata` for bulk
    filesystem reorgs.
  - `plex_browse` gains an optional `fields: string[]` parameter.
    Client-side projection — Plex still sends the full payload but
    each item is filtered to just the listed keys before returning.
    For audits: `fields=['ratingKey','title','year', ...]` shrinks
    responses ~20× (under 200 bytes/item vs. ~4KB) so populated
    sections don't blow the LLM output token cap.
  - Tests: 31 → 36. Round-trip tests for editMetadata (summary
    capture + restore) and unmatch (capture GUID + title, unmatch,
    restore via applyMatch). refresh_section is a single
    incremental call without `force=1` (deep refresh is expensive
    against live Plex). fields projection asserts only requested
    keys appear in each item.

- **v0.7.1 patch release (2026-05-17).** Backfills GHCR with a
  working semver image. The v0.7.0 tag's docker-publish build
  failed (lockfile had orphaned `@rolldown/binding-*` references
  declaring nested `@emnapi/core@1.10.0` / `@emnapi/runtime@1.10.0`
  deps without their resolved node_modules entries; `npm install`
  tolerated it, `npm ci` rejected it). Fix: `rm -rf node_modules
  package-lock.json && npm install` to regenerate from scratch.
  Verified inside the canonical node:22-alpine + npm 10
  environment. Bundles the three v0.8 items already on main —
  plex_get_image, plex_get_item minimal/fields, tool annotations
  — because the lockfile was regenerated from current state, not
  cherry-picked back to v0.7.0. Slight semver fudge (features in
  a patch tag) accepted as the simpler path for a personal repo.

- **v0.8 in flight (2026-05-17).** Four items shipped so far.
  Tool count 29 → 31 (two new tools; the third + fourth items
  enhance existing tools or all tools collectively).
  - **`plex_save_image`** — companion to plex_get_image. Same input
    surface (rating_key / image_url / image_type / max_width /
    max_height) plus a required `filename` (basename only —
    rejects '/', '\\', '..', leading '.'). Writes bytes to
    `${MCP_IMAGE_SAVE_DIR}/${filename}` inside the container
    (default `/data/images/`). Returns `{path, bytes_written,
    mime_type}` as text — NOT an image content block. The bridge
    for "no human in the loop" pipelines that need the bytes at a
    file path (ImageMagick composite, filesystem-mcp consumer,
    etc.) rather than rendered inline for a vision model.
    Operator bind-mounts the host directory they want files in
    onto `/data/images/` (or sets `MCP_IMAGE_SAVE_DIR` to a
    different in-container path and mounts there). docker-compose
    gained a commented `/volume1/Media/_mcp-scratch:/data/images`
    example as the natural bridge to filesystem-mcp's `/media`
    root. Tests added (40 → 42): tmpdir-scoped save round-trip
    (asserts file written + magic-byte sniff matches JPEG/PNG) +
    traversal-rejection guard.

  - **ChatGPT Apps SDK Phase 1: tool annotation hints on every
    tool.** Per the spec at docs/CHATGPT-APPS-SDK.md, each tool's
    `registerTool` config now carries an `annotations` block with
    `readOnlyHint` / `destructiveHint` / `idempotentHint` /
    `openWorldHint` per the MCP `ToolAnnotations` schema. Four
    canonical shapes defined in `src/tools/helpers.ts`:
    - `READ_ONLY_ANNOTATIONS` — for the 19 read tools (search,
      list, get, browse, history, hubs, related, similar,
      get_matches, get_image, get_playlist_items, list_playlists,
      now_playing, recently_added, on_deck, get_item,
      get_children, hubs/section_hubs).
    - `SAFE_WRITE_ANNOTATIONS` — mutating but non-destructive,
      not idempotent: mark_watched, mark_unwatched (scrobble
      bumps lastViewedAt each call), create_playlist,
      add_to_playlist, remove_from_playlist, split_item,
      merge_items.
    - `SAFE_IDEMPOTENT_WRITE_ANNOTATIONS` — mutating, idempotent
      (re-running has same effect): refresh_metadata, apply_match,
      edit_metadata, unmatch, refresh_section.
    - `DESTRUCTIVE_ANNOTATIONS` — genuine destruction:
      delete_playlist (only true destruction in the toolset; the
      playlist disappears, though the underlying media is
      untouched).
    `openWorldHint: false` on every tool — all operations touch
    only the user's own Plex server. No tool descriptions changed
    in this pass; description-style polish ("Use this when…") is
    a separate scope.


  - **`plex_get_item` sparse projection + minimal mode.** The
    biggest token-economy offender per the 2026-05-11 retro (full
    responses were 80–100 KB on movies with deep casts; Role[]
    alone was 80%+ of the payload). Two new options:
    - `minimal=true` returns a curated lean view. Drops Role[],
      Director[], Writer[], Producer[], Image[], UltraBlurColors,
      Country[], Style[], Mood[] at the top level, plus Stream[]
      inside each Media.Part. Keeps Guid[], Media.Part.file (the
      operational must-have for filesystem ops), Field[] lock
      state, editionTitle, viewed state (viewCount/lastViewedAt),
      and all primary identity fields.
    - `fields=[...]` allowlist projection — explicit overrides
      `minimal` when both are set.
    - Mirrors the `plex_browse` projection pattern shipped in v0.6.
      Client-side filter; Plex's API still sends the full payload
      so the bandwidth win goes only to the MCP-LLM boundary, but
      that's where the token-cap pain was.
    - Tests added (38 → 40): minimal mode asserts bulky arrays
      dropped + Stream[] removed from Part[] + identity fields
      preserved; fields mode asserts exact key set.

  - **`plex_get_image`** — first new v0.8 tool. Returns poster/art/
    banner/squareArt/clearLogo bytes as an MCP image content block
    (`{type: "image", data: <base64>, mimeType}`), not as text-
    wrapped base64 — the distinction that makes vision-capable
    clients actually see the picture.
    - Two entry points: `rating_key` (default fetches the selected
      poster via the item's direct `thumb`/`art`/`banner` field;
      falls back to `Image[]` for `squareArt`/`clearLogo` which
      have no direct field) or `image_url` (a pre-resolved relative
      Plex path like `/library/metadata/.../thumb/...` from a prior
      tool response). image_url paths must start with `/` —
      defense-in-depth so we don't proxy arbitrary URLs.
    - Resize support via optional `max_width` / `max_height`
      routes through Plex's `/photo/:/transcode` endpoint. Plex's
      transcoder rejects width-only or height-only requests; when
      only one dimension is given we mirror it to the other (Plex
      preserves aspect ratio internally). minSize=1 + upscale=0
      in the request.
    - Size cap defaults to 4 MiB raw (~5.3 MB after base64,
      Claude's practical per-image limit); override via
      `MCP_IMAGE_MAX_BYTES`. Cap-exceeded error suggests
      `max_width=800` as the workaround. We check `Content-Length`
      pre-read when available, plus a post-read guard for servers
      that don't send it.
    - PlexClient gained `fetchBinary(path, params)` (no JSON parse,
      `Accept: image/*`, strips Content-Type parameters down to
      the bare MIME) and public `getImageBytes(args)`. New
      `helpers.asImage(buffer, mimeType)` sibling to `asText`;
      `ToolResult` typing broadened to allow image blocks.
    - Tests added: structural shape check (magic-byte sniff for
      JPEG/PNG), plus transcode happy-path with `max_width=200`.
    - Write side (`plex_set_image` / poster upload) deferred —
      will unify with the queued poster-management work below.

- **v0.7 shipped: 2 new admin tools (27 → 29 total).** Closes the
  remaining audit-derived items by giving Plex's own "Split Apart"
  + "Merge" web-UI surface to the MCP toolset.
  - `plex_split_item` (PUT `/library/metadata/{key}/split`) — split
    an auto-merged Plex item back into its constituent media as N
    separate items. The audit's earlier speculation ("Plex has no
    item-split primitive") was wrong; `split` is exactly what the
    web UI calls. Cross-validated against python-plexapi's
    `split_merge.py` mixin and live-probed before ship.
  - `plex_merge_items` (PUT `/library/metadata/{key}/merge?ids=<csv>`)
    — merge other items INTO a target. Sources absorbed; target
    survives. Symmetric inverse of split.
  - No automated tests added for either — both mutate Plex catalog
    state in ways that aren't safely round-trippable against a
    real library. Covered by live-probe verification during ship.
  - Unblocks operator actions for WWE SummerSlam Night 2 (split →
    apply_match) and WWE Royal Rumble 2026 triplicate (merge,
    which sidesteps the apply_match permission-hook false
    positive entirely).
  - v0.7.0 release also bundles opt-in HTTPS on the HTTP transport
    (see separate entry below) and the ChatGPT Apps SDK alignment
    spec at `docs/CHATGPT-APPS-SDK.md` — future work, not started.

- **HTTPS support on the HTTP transport (2026-05-17).** Opt-in TLS
  for the Streamable HTTP listener. New `src/tls.ts` module
  resolves credentials in order: BYO PEM files
  (`MCP_TLS_CERT_FILE` + `MCP_TLS_KEY_FILE`), then self-managed
  (`MCP_TLS=auto` generates an ECDSA P-256 self-signed cert under
  `MCP_TLS_DIR`, default `/data/certs`, with SAN configurable via
  `MCP_TLS_SAN`), then plain HTTP. Self-managed mode reuses the
  on-disk cert across restarts and regenerates when <30 days
  remain. SHA-256 fingerprint and `notAfter` logged on startup so
  clients can pin the cert. docker-compose.yml gained commented
  env-var + volume blocks; README has an "Enabling HTTPS" section
  covering both modes plus a reverse-proxy-as-alternative note.
  Dep added: `selfsigned@^5.5.0` (ships its own types; v5 is async
  and supports ECDSA). No automated tests added — manual smoke
  verified `curl --cacert server.crt https://localhost:3443/health`
  returns `{"status":"ok","transport":"https"}` and a restart
  reuses the on-disk cert without regen. CLAUDE.md "no auth" note
  reworded — TLS encrypts in transit but doesn't authenticate
  callers; the bearer-token gap remains as future work if exposing
  beyond LAN.
- **Security: image_url guard hardened against protocol-relative
  URLs (fleet-review #1).** The tool-layer check
  `image_url.startsWith("/")` accepted `//attacker.tld/x` (and the
  WHATWG-URL backslash variant `/\attacker.tld/x`), which
  `new URL(path, PLEX_URL)` resolves to an arbitrary host —
  `fetchBinary` would then send `X-Plex-Token` there. Fixed at both
  layers: shared `assertRelativePlexPath` helper in
  `src/tools/helpers.ts` (used by `plex_get_image` +
  `plex_save_image`) rejects `//` and `/\` prefixes, and
  `PlexClient.fetchBinary` now asserts the resolved URL stays on the
  configured Plex origin (single choke point). New non-networked
  unit suite `tests/image-url-guard.test.ts` covers both layers and
  runs in CI where the live-Plex integration suite skips.
- **Dev-chain upgraded to eslint 10 + Dependabot #4's bumps applied
  manually (2026-07-29).** eslint ^9 → ^10.8.0, @eslint/js → ^10.0.1,
  eslint-config-prettier → ^10.1.8 (clears the npm-audit highs in the
  dev-only eslint chain — minimatch/brace-expansion DoS), plus the
  npm-dev group from Dependabot #4: prettier ^3.9.6 (its 3.9
  formatting applied to src/plex.ts + tests/plex.test.ts — the reason
  #4's CI failed, Dependabot bumps but never reformats), tsx ^4.23.1,
  typescript-eslint ^8.65.0 (peer range already covers eslint 10),
  vitest ^4.1.10. ESLint 10's new `preserve-caught-error` rule flagged
  the two saveImage rethrows — fixed by attaching `{ cause: err }`
  (messages unchanged). Also bumped @modelcontextprotocol/sdk ^1.30.0
  + @hono/node-server transitive to 2.0.12 (same GHSA path-traversal
  moderate portainer-mcp cleared as Dependabot #31 there). npm audit
  now reports 0 vulnerabilities. Verified: lint + typecheck + build +
  8/8 unit tests (42 live-Plex integration tests skip locally as
  always). Runtime majors (express 5, undici 8, zod 4, TS 7) remain
  deliberately deferred — see the closed npm-major PR #5.

- **Fleet standards-audit issue #8 — Tier 1+2 closed (2026-07-31).**
  The audit (filed 2026-07-25) found 11 failing standards checks plus
  9 judgment-call items. Re-verified against current `main` before
  starting: UNI-01 (LICENSE) and UNI-15 (personal-domain email in
  public history) were already resolved — the latter via a history
  rewrite that also explains why the OC git-onboard watermark had
  gone stale (its recorded commit no longer exists). Closed the rest
  of the mechanical findings across 6 commits:
  - `needs: test` gates `docker-publish.yml`'s build job (UNI-14) —
    a red `main` could previously still ship `:latest`.
  - Standalone `gitleaks` CI workflow added (UNI-04) — the local
    pre-commit hook is bypassable (`--no-verify`, unset
    `core.hooksPath`, a merge via the GitHub API), which is exactly
    how the now-scrubbed personal email reached history in the
    first place.
  - `MCP_IMAGE_MAX_BYTES=""` no longer silently disables the image
    size cap (MCP-P07) — extracted `resolveImageMaxBytes()` in
    `src/plex.ts`, unit-tested without a live Plex server.
  - Dockerfile gained a `HEALTHCHECK` conditional on `MCP_PORT`
    (MCP-E01) — stdio-mode containers short-circuit to healthy since
    they have no HTTP server at all; HTTP-mode containers probe the
    real endpoint. Verified both paths with a local `docker build`.
  - `CHANGELOG.md` backfilled (UNI-12) from git tags + this file's
    history; `.editorconfig` added verbatim from the fleet template
    (UNI-06); `CLAUDE.md` gained the "Fleet standards: ts-mcp-server
    v1.0" stamp (UNI-09).
  - `plex_split_item` / `plex_merge_items` (consume/absorb
    ratingKeys) and `plex_apply_match` (prior binding not
    recoverable) were annotated `destructiveHint: false` despite
    their own descriptions saying otherwise (MCP-P02) — fixed, and
    added `DESTRUCTIVE_IDEMPOTENT_ANNOTATIONS` for the
    destructive-but-idempotent case `apply_match` needed.
  - `tests/tool-annotations.test.ts`, `tests/tool-naming.test.ts`,
    `tests/version-sync.test.ts` added (MCP-T01/T02/T03) — each
    verified to actually fail on a reverted regression before being
    left in its passing state. `src/version.ts` now holds
    `SERVER_VERSION` as the one place both `package.json` and
    `src/index.ts` derive from (well, the former is still hand-kept
    in step — the test is what keeps them honest).
  Deferred to a follow-up discussion (judgment calls, not
  mechanical): UNI-16 (internal hostname/paths in tracked files,
  fleet-wide — resolved as a non-issue for this repo's current tree,
  see below), MCP-F03 (HTTP transport hardening — resolved, see
  below), MCP-P06 (name-confirmation on destructive tools), MCP-P04/P05
  (redaction chokepoint + log verbosity), MCP-F01/F02 (fetch timeouts +
  retry/backoff), MCP-S01 (whether to adopt the fleet's `src/shared/`
  layer wholesale or just fill its couple of genuine gaps — leaning
  toward the latter, this repo predates the convention and has working
  hand-rolled equivalents).
- **UNI-16 re-verified and closed as a non-issue for this repo's current
  tree (2026-08-03).** The audit's cited evidence for `docker-compose.yml`
  (a literal real hostname in the TLS SAN example) doesn't match what
  `git blame` shows was ever committed — that example has said
  `"your-nas"` since it was introduced. `CLAUDE.md` has zero matches;
  `STATUS.md`'s only matches are generic `/volume1/Media/...` paths (every
  Synology NAS uses `/volume1`), not a hostname. The only real residue is
  3 old commit messages mentioning the real hostname in prose — not worth
  a history rewrite (the UNI-15 remediation shape) for a LAN-only,
  non-internet-resolvable name.
- **MCP-F03 HTTP transport hardening closed (2026-08-03).** Two of the
  four flagged gaps addressed; the other two stay deliberately deferred:
  - **Host/Origin allowlist (DNS-rebinding defense) — added.**
    `MCP_ALLOWED_HOSTS` (required in HTTP mode; server refuses to start
    without it, `docker compose config` fails the same way) and
    `MCP_ALLOWED_ORIGINS` (optional, default empty) gate `/mcp` in
    `src/index.ts`. The MCP SDK's own `allowedHosts`/`allowedOrigins`/
    `enableDnsRebindingProtection` transport options are `@deprecated`
    in favor of external middleware, so this is hand-rolled instead.
    `/health` stays unguarded (no side effects, and the Docker
    `HEALTHCHECK` needs it reachable). Verified locally: missing
    `MCP_ALLOWED_HOSTS` exits 1 at startup; correct Host reaches the
    handler; wrong Host → 421; correct Host + disallowed Origin → 403;
    `/health` stays 200 regardless of Host.
    Considered auto-appending `host.docker.internal:${HOST_PORT}` in
    `docker-compose.yml` so a sibling MCP container on the same Docker
    host (reaching back in via the published port, not the internal
    Docker network) could call this server without a second stack-env
    edit — reversed that after pushback: `MCP_ALLOWED_HOSTS` is a
    security allowlist, not a harmless convenience default like
    `extra_hosts`, so templating part of it into compose would make the
    real effective policy invisible from the stack's env list alone
    (you'd have to cross-reference the compose file too) and would
    remove the operator's ability to opt out. Stays a plain
    operator-set stack-env value instead, same as `PLEX_URL`/
    `PLEX_TOKEN`/`HOST_IMAGE_DIR` — add `host.docker.internal:<port>`
    to it explicitly if a sibling MCP needs access. Verified locally
    with both entries present: the LAN hostname and
    `host.docker.internal:<port>` both reach the handler; an unrelated
    host is still rejected with 421.
  - **Idle-session eviction — added.** `transports` previously only
    cleaned up via client-initiated `onclose`; a client that disappears
    uncleanly (crash, network drop) leaked its session forever in this
    long-running container. A `lastActivity`-tracked, `.unref()`'d sweep
    (`MCP_SESSION_IDLE_TIMEOUT_MS`, default 1h) now evicts and closes
    idle sessions. Verified locally with a 3s timeout: session created,
    evicted after ~4.6s idle, subsequent use of the evicted session-id
    correctly falls through to the unknown-session branch.
  - **Bearer-token auth — still deferred.** Nothing changed here:
    still LAN-only, no internet exposure, matches CLAUDE.md's existing
    accepted tradeoff. Revisit alongside the ChatGPT Apps SDK Phase 2
    OAuth work rather than building a bespoke scheme now.
  - **`MCP_BIND_HOST` — still not applicable.** Binding a specific
    interface means nothing extra inside a container (docker-deployments.md
    rule #8); the allowlist is the real boundary, not the bind address.
  - **Deploy sequencing, learned from the `HOST_IMAGE_DIR` incident:**
    set `MCP_ALLOWED_HOSTS` on the Portainer stack *before* shipping this
    code, so there's no window where a redeploy lands with enforcement
    on but the allowlist unset.
- **MCP-E02 compose-parameterization gap closed (2026-07-31).** Flagged
  by the same audit that containerized kindroid-mcp: `docker-compose.yml`
  hardcoded the `volumes:` host path to an absolute NAS path
  (`/volume1/Media/_mcp-scratch`) with zero `${}` indirection, and never
  set the code-supported `LOG_LEVEL` at all. Now `${HOST_IMAGE_DIR:-./data/images}`
  and `LOG_LEVEL: "${LOG_LEVEL:-info}"`, both Portainer-overridable.
  `MCP_PORT` stays hardcoded deliberately — it's container-internal
  wiring matching `EXPOSE`/`HEALTHCHECK`, exempt per the standard.
  `MCP_BIND_HOST` was considered and deferred — same MCP-F03 tradeoff
  noted above, not a new gap.
- **MCP-E02's relative volume default took the deployment down ~10h
  (2026-07-31).** The `${HOST_IMAGE_DIR:-./data/images}` fallback above
  is a trap in a Portainer git stack: each redeploy clones the repo
  into a fresh `/data/compose/<stack-id>/<commit>/` directory where
  `./data/images` doesn't exist, Docker refuses the bind mount, and
  the container lands in `created` state — never starting, with no
  restart policy to save it. An automatic redeploy triggered it; the
  stack stayed down until
  `HOST_IMAGE_DIR=/volume1/Media/_mcp-scratch` was set in the stack's
  Portainer environment variables (now set; service healthy — that
  path matches filesystem-mcp's `/media/_mcp-scratch` mount, closing
  the plex_save_image → filesystem-mcp loop). README's Portainer
  section now documents `HOST_IMAGE_DIR` as required for git-stack
  deploys plus the stuck-in-`created` failure mode. Fleet lesson
  filed in claude-fleet-kit:
  `2026-07-31-relative-compose-volume-defaults-break-portainer-git-stacks`.
- **MCP-P06 destructive-tool name confirmation closed (2026-08-03).**
  `plex_delete_playlist`, `plex_split_item`, and `plex_merge_items`
  previously gated on an opaque ratingKey/id alone — a transposed digit
  would act on the wrong target with nothing to notice. Each now
  requires `confirm_title` (`confirm_into_title` for merge) matching
  the resolved target's actual current title before proceeding, via a
  new `assertNameMatches()` helper in `src/tools/helpers.ts`. Unlike a
  bare `confirm: true` flag — advisory against an autonomous agent,
  which can always self-supply it — a wrong id resolves to a
  *different* item whose real title won't match what the caller
  expected, so the mismatch surfaces before anything is
  deleted/consumed. `source_rating_keys` on `plex_merge_items` are not
  individually confirmed (only the target) — matches the audit's own
  scoped finding and keeps the fix proportionate; noted in the tool
  description so callers double-check sources themselves. Breaking
  change to the 3 tools' input shape (documented in CHANGELOG); no
  live-infra coordination needed since this is a tool-schema change,
  not an env var. Added `tests/name-matches-guard.test.ts` (unit tests
  for the helper) and `tests/destructive-confirm-guard.test.ts` (wiring
  tests proving each tool actually refuses the mismatched case and
  never calls its destructive PlexClient method — not just that the
  helper exists somewhere unused).
- **MCP-P04/P05 redaction + log verbosity closed (2026-08-03).**
  Verified both findings against a live capture rather than trusting
  the audit's description at face value (per this repo's own
  api-integration.md rule) — called the real `plex_now_playing` and
  `plex_history` directly:
  - `plex_now_playing`'s session payload really does carry
    `Player.address` (the client's LAN IP) and
    `Player.remotePublicAddress` (a real public IP) — confirmed on the
    live server. Neither is relevant to "what's playing right now."
    Added `redactSessionPlayerAddress()` in `src/tools/helpers.ts`,
    applied narrowly to `plex_now_playing` only — this is a fix for
    the one concrete exposure the audit found, not a general response
    sanitizer. `plex_history`'s entries carry no `Player` object at all
    (also confirmed live — just opaque `accountID`/`deviceID`), so
    nothing to redact there; scope stayed matched to what's real.
  - `withLogging()` (`src/tools/helpers.ts`) previously logged full
    tool-argument values at `info` on every invocation. Split into two
    lines: `info` now logs only `{ keys: Object.keys(args) }`; a new
    `debug`-level line carries the full values. Real user content that
    was landing in default-level container logs — `plex_search.query`,
    `plex_edit_metadata.fields.title/summary`,
    `plex_save_image.filename` — now requires `LOG_LEVEL=debug` to see.
  - Added `tests/redact-session-player.test.ts` and
    `tests/log-verbosity.test.ts`; both verified against a reverted
    regression (removed the `remotePublicAddress` redaction / reverted
    the log split, confirmed each test fails, reverted back).
- **MCP-F01/F02 fetch timeout + bounded 429 retry closed (2026-08-03).**
  All three outbound Plex fetch call sites (`request`,
  `requestNoContent`, `fetchBinary` in `src/plex.ts`) previously called
  `fetch()` directly with no timeout and no retry handling. Extracted a
  shared `fetchWithTimeoutAndRetry()` private method — a single
  chokepoint all three now route through, rather than duplicating
  timeout/retry logic three times:
  - Every call carries `AbortSignal.timeout(MCP_FETCH_TIMEOUT_MS)`
    (default 30s, optional/Portainer-overridable) — a hung or
    half-open Plex server can no longer block a tool call indefinitely.
  - A `429` response is retried up to 2 times, honoring `Retry-After`
    (seconds or an HTTP-date, both parsed) bounded to a 30s cap — an
    unbounded wait on a large header value would otherwise stall the
    whole request queue behind one call. Exhausting the retries
    surfaces the 429 as a normal tool error.
  - 13 new tests (`tests/fetch-timeout-retry.test.ts`): unit coverage
    for the two pure helpers (`resolveFetchTimeoutMs`,
    `parseRetryAfterMs` — bounds, HTTP-date parsing, malformed-header
    fallback) plus a wiring suite that mocks global `fetch` and drives
    an actual public `PlexClient` method end-to-end: retries once on
    429 then succeeds, gives up after the cap without retrying forever
    (verified against a reverted cap — the test times out rather than
    passing, confirming it would actually catch an infinite-retry
    regression), and confirms every call carries a real `AbortSignal`.
- **MCP-S01 closed — partial adoption, full `src/shared/` template
  match declined (2026-08-03).** This was the last open item from the
  fleet standards-audit (issue #8), and the one requiring an actual
  judgment call rather than a mechanical fix. Enumerated every direct
  `process.env.*` read across the codebase first: 16, across
  `src/index.ts` (6), `src/tls.ts` (6), `src/plex.ts` (3), `src/log.ts`
  (1) — more than the audit's original count of 12, since this
  session's own MCP-F03/F01 work added new scattered reads
  (`MCP_ALLOWED_HOSTS`/`ORIGINS`, `MCP_SESSION_IDLE_TIMEOUT_MS`,
  `MCP_FETCH_TIMEOUT_MS`).
  - **Declined:** moving `src/log.ts`'s `LOG_LEVEL` parsing,
    `src/tools/helpers.ts`'s annotation constants /
    `redactSessionPlayerAddress`, and `src/version.ts` into a literal
    `src/shared/` directory tree matching the template's file names
    (`text.ts`, `annotations.ts`, `redact.ts`, `version.ts`). All three
    already work, are already tested, and already live in sensible
    places — moving them is pure file-shuffling for template
    conformance, with real churn (every `tools/*.ts` import path
    changes) and zero behavior improvement. Matches this repo's
    "don't rewrite what works" default.
  - **Declined, more carefully:** centralizing `src/tls.ts`'s
    `MCP_TLS_*` vars into an eager config read. These are deliberately
    read *lazily*, only inside `resolveTlsCredentials()`, which only
    runs in HTTP+TLS mode. Forcing them into module-load-time reads
    (what a naive `config.ts` would do) would be a real behavior
    change: an invalid `MCP_TLS_DAYS` would start failing *stdio-mode*
    startups it has zero effect on today. Same reasoning for
    `src/plex.ts`'s `MCP_IMAGE_SAVE_DIR` / `MCP_IMAGE_MAX_BYTES` /
    `MCP_FETCH_TIMEOUT_MS` — already behind tested pure `resolve*()`
    functions, read once per call; moving to eager per-construction
    reads is a negligible behavioral difference (env vars don't change
    during a running container's life) not worth the risk for this
    session's remaining scope.
  - **Adopted:** the part of MCP-S01 that was a genuine, safe win —
    added `src/config.ts` centralizing the 6 vars that were *already*
    read and validated eagerly at module-load time in `src/index.ts`
    (`PLEX_URL`, `PLEX_TOKEN`, `MCP_PORT`, `MCP_ALLOWED_HOSTS`,
    `MCP_ALLOWED_ORIGINS`, `MCP_SESSION_IDLE_TIMEOUT_MS`), preserving
    their exact validate-or-`exit(1)` semantics byte-for-byte — same
    timing, same messages, just relocated from ~40 scattered lines in
    `index.ts` into one module. `index.ts` now destructures `config`
    instead of reading `process.env` directly.
  - Verified behavior-preservation with real `docker build`/`run`
    across all paths: missing `PLEX_URL`/`PLEX_TOKEN` → exit 1, same
    message; invalid `MCP_PORT` → exit 1, same message; HTTP mode
    missing `MCP_ALLOWED_HOSTS` → exit 1, same message; valid HTTP
    config → starts and reports healthy; stdio mode → real MCP
    `initialize` handshake succeeds, correct `serverInfo.version`. All
    five identical to pre-refactor behavior.
  - This closes [issue #8](https://github.com/CarlDog/plex-mcp/issues/8)
    — every item from the 2026-07-25 fleet standards audit is now
    either fixed or explicitly declined with reasoning on record.

## Next

- **`plex_upload_poster` (close-the-loop write side).** Elevated
  from the v0.8 poster-management queue because today's poster
  design handoff with Claude Desktop confirms the round-trip needs
  an upload side. Plex API: `POST /library/metadata/{rk}/posters`
  with either `url=<external>` (Plex fetches) or a binary body (we
  POST the bytes ourselves). Plex stores as a new candidate and
  optionally makes it active. For the file-pipeline case (poster
  saved at `/data/images/foo.jpg` by plex_save_image, processed by
  a local compositor, ready to push back), the binary-body path is
  natural — read the file inside the container, POST to Plex,
  return the updated `selected` poster reference.
  Cross-validate against python-plexapi's `mixins/poster.py` for
  exact endpoint + headers before shipping. Annotations:
  `SAFE_WRITE_ANNOTATIONS` (mutating; not idempotent — each call
  creates a new candidate).

- **ChatGPT Apps SDK alignment — Phase 1 done, Phases 2–4 not
  started.** See [docs/CHATGPT-APPS-SDK.md](docs/CHATGPT-APPS-SDK.md)
  for the full punch list. TL;DR: ChatGPT cannot consume plex-mcp
  today because (1) the server isn't internet-reachable and (2) it
  has no OAuth 2.1 protected-resource setup. Phase 1 (tool
  annotation hints) shipped 2026-05-17. Phases 2–4 cover OAuth
  middleware in plex-mcp, Cloudflare Tunnel + Auth0 (or self-hosted
  IdP), and end-to-end ChatGPT dev-mode verification. Total
  estimated remaining effort ~week of evening time, distributed.

- **Cross-MCP file-passing pattern is live.** plex_save_image →
  `/data/images/` (= host `/volume1/Media/_mcp-scratch/`) →
  filesystem-mcp `/media/_mcp-scratch/`. Reusable for any future
  producer-consumer MCP workflow on this host. Pattern captured in
  OC memory (id `43abc163`); when extending to a second producer
  (servarr-mcp → filesystem-mcp, downloader-mcp → filesystem-mcp),
  the convention is a dedicated subdir under `/volume1/Media/`
  (e.g. `_arr-scratch/`).

- **Other v0.8 / v0.9 candidates carried from v0.7 queue.**
  Endpoint shapes confirmed against python-plexapi 2026-05-13
  (see `docs/PLEX-API.md` cross-validation section). None
  shipped yet:
  1. `plex_rate_item(rating_key, rating)` — `PUT /:/rate?...` —
     0–10 scale to 0–5 stars. pkkid `mixins/rating.py`.
  2. `plex_remove_from_continue_watching(rating_key)` —
     `PUT /actions/removeFromContinueWatching?ratingKey=` —
     cleans up the Continue Watching hub. pkkid `video.py`.
  3. `plex_update_timeline(rating_key, time_ms, state, duration_ms?)` —
     `GET /:/timeline?...` — set playback resume position. Was
     deferred in v0.4 as "low value vs scrobble"; pkkid
     confirms shape now. Reconsider whether to ship.
  4. `plex_empty_section_trash(section_id)` — `PUT /library/sections/{id}/emptyTrash`
     — post-cleanup helper for bulk filesystem ops.
  5. Section-scoped `plex_on_deck(section_id?)` — extend the
     existing tool with optional `section_id` arg
     (`GET /library/sections/{id}/onDeck`).
- **Outstanding audit items now closed by v0.6 + v0.7.** All four of
  the originally-blocked WWE PPV items have a resolution path
  using shipped tools. Pending only operator actions.
- **Music section audit not yet done.** Audit (§2.3) found `[no
  artist]` and `[unknown]` placeholder buckets and a possible
  `John Williams` artist split (case-insensitive collision).
  Album / track titles weren't enumerated.
- **Categories not yet audited.** Episode-level titles in any TV /
  Anime / Kids / Webseries section; albums / tracks under Music;
  the `TESTING` libraries (`hidden: 2`, skipped by judgment);
  orphan files on disk vs. Plex catalog; library type-mismatch
  detection.
- **External dependencies on other repos.**
  - `servarr-mcp` needs `radarr_delete_movie` (and
    `sonarr_delete_series`). The WWE PPV cleanup had to bypass
    Radarr through filesystem MCP; Radarr's catalog drifted from
    disk. Pattern recurs whenever removal-as-workflow comes up.
  - `plex-mcp` permission-hook needs a `get_matches → apply_match`
    correlation heuristic: an `apply_match(ratingKey=X, guid=G)`
    preceded within N tool calls by a `get_matches(ratingKey=X)`
    that returned `{guid: G}` should pass without a prompt. Two
    false-positive denials documented during the audit cleanup.
- **Collections support (captured 2026-06-07 from the "CarlDog's
    Favorites" backup-copy session).** Task: enumerate a Movies
    collection's members + their on-disk paths to copy the folders to a
    second NAS. **No current tool can list a collection or its members**
    — this turned a one-call job into a direct-Plex-API workaround
    script. The gap, with proposed fixes (endpoints cross-validated
    against pkkid `library.py` / `collection.py`):
    1. **`plex_list_collections(section_id)`** —
       `GET /library/sections/{id}/collections`. Mirrors
       `plex_list_playlists` exactly (thin wrapper; add
       `listCollections()` to `PlexClient`, register in
       `tools/discovery.ts`). Returns each collection's `ratingKey`,
       `title`, `childCount`. Closes "find a collection by name."
    2. **`plex_get_collection_children(rating_key)`** —
       `GET /library/collections/{ratingKey}/children`. Mirrors
       `plex_get_playlist_items`. The direct "list members" call.
       ⚠️ Root cause of the gap: a collection's ratingKey **404s** on
       `/library/metadata/{key}` and `/library/metadata/{key}/children`
       — which is exactly what `plex_get_item` and `plex_get_children`
       hit (`plex.ts` `getItem`/`getChildren`). Collections live under
       `/library/collections/`, a different path. Should honor the
       `fields` / `minimal` projection — members carry full movie
       payloads, but the copy use case only needed `Media.Part.file`.
    3. **Collection discovery via search.** `plex_search` uses
       `/search`, which omits collections entirely (verified: exact
       title returned `[]`). `docs/PLEX-API.md` already documents the
       richer `GET /hubs/search?query=&includeCollections=1&includeExternalMedia=1`.
       Either upgrade `plex_search` to `/hubs/search` or add
       `plex_hub_search` so collections (and other hub types) are
       findable by name.
    4. **(Optional, lower priority) `collection=` filter on
       `plex_browse`.** `GET /library/sections/{id}/all?collection={rk}`
       also returns members — a one-line add to `browse()`'s `params`.
       Same change would naturally generalize to other section filters
       (genre / year / unwatched), so weigh as a small filter-param
       feature rather than a collections-only fix.
    - Partial path that exists today: `plex_related(rating_key)`
      returns a "From this collection" hub, so item→collection is
      reachable — but there is no collection→members path.
    - **DX bug observed:** `plex_browse`'s `fields` projection
      silently drops requested keys that aren't in the section-listing
      payload (e.g. `Collection`, which is full-metadata-only), with no
      signal — so "this movie has no collections" is indistinguishable
      from "the field was never present at this layer." Document which
      fields live at the browse layer vs. the `get_item` layer; consider
      noting unavailable keys in the response.
    - **Doc follow-up:** add the two collection endpoints
      (`/library/sections/{id}/collections`,
      `/library/collections/{rk}/children`) to `docs/PLEX-API.md`'s
      "capabilities we haven't built yet" table.

- **v0.8 candidates (captured 2026-05-11 from WWE PPV
  consolidation + Panty & Stocking multi-episode rename
  session).** Concrete tool / doc gaps observed in actual use:
  1. **Sparse `fields` projection on `plex_get_item`.** Items
     with many Media variants blow the MCP response cap — Royal
     Rumble 2025 had 14 variants, response was 97k characters,
     forced a dump-file workaround. Same problem `plex_browse`
     had pre-v0.6; same fix applies. Default-on filter for
     `Role` / `Producer` / `Stream` arrays would help most.
  2. **Document Editions thoroughly in `docs/PLEX-API.md`.** The
     `editionTitle` field, the `{edition-<name>}` filename tag
     Plex's scanner reads, and the consolidation recipe (multi-
     night events sharing one IMDB/GUID → Editions instead of
     fighting auto-merge with split/unmatch). This session
     codified the convention; the API doc should reflect it.
  3. **Document the `tv.plex.agents.none://<rating_key>` GUID
     format** for unmatched items. Useful for tooling that
     distinguishes matched vs unmatched without parsing the
     `Guid` array.
  4. **Document the ratingKey-churn-on-path-change behavior.**
     When `fs_move` renames a folder/file, Plex's rescan
     sometimes re-mints the ratingKey (creating a new item +
     orphaning the old) instead of updating the path on the
     existing rk. Locked title overrides do NOT always survive
     this churn. Downstream callers holding rk references in
     playlists, history, or external indices must be defensive.
  5. **`plex_refresh_section` async semantics need a note in
     the tool description.** Tool returns immediately, but the
     server-side disk scan continues. Empirically: after bulk
     `fs_move` operations, the *first* refresh detached old
     episodeFileIds without re-attaching new ones; a *second*
     refresh completed the reconciliation. Either document the
     two-pass pattern or add an optional `wait_for_scan`
     follow-up tool.
  6. **`Field` array on `plex_get_item` exposes which fields
     are locked** (`title`, `titleSort`, `thumb`, etc.). This is
     useful for tooling but undocumented in PLEX-API.md. Worth
     a one-liner.
- **v0.8 candidates: poster / image management.** User reports that
  Plex's auto-picked posters are often awful — sometimes the bound
  agent (TMDB/TVDB) has better candidates already, sometimes the
  agent's whole set is poor and a custom URL would fix it. Plex's
  HTTP API exposes the lifecycle but plex-mcp doesn't surface it yet.
  Layer 1 (in this repo, ~150 lines + tests):
    - `plex_list_posters(rating_key)` — `GET /library/metadata/{rk}/posters`.
      Returns candidate list per provider with `selected` flag.
    - `plex_set_poster(rating_key, provider, key)` — apply an
      existing candidate from the agent's catalog.
    - `plex_upload_poster(rating_key, url, select?: bool=true)` —
      `POST .../posters?url=...`. Plex fetches the image and adds it
      as a new candidate; by default makes it the active poster.
  Cross-validate the endpoint shapes against python-plexapi's
  `mixins/poster.py` per the existing PLEX-API.md cross-validation
  pattern. Parallel endpoints `arts` and `themes` exist with the
  same shape — defer those until Layer 1 proves the pattern.
  Open design questions to settle before code:
  - Three named tools (list/set/upload) vs one unified
    `plex_image_action(kind=posters|arts|themes, action=...)`.
    Leaning three named tools for discoverability; add arts/themes
    later if the pattern is useful.
  - Upload-by-URL only, or also accept local file paths via
    filesystem-mcp's reach? URL-only is simpler (no multipart, no
    upload bandwidth through plex-mcp). File path adds meaningful
    complexity for a small win unless the user has images on the
    NAS to push.
  - `select` semantics on upload: default true (new poster becomes
    active), with `select=false` opt-out for add-without-applying
    review workflows.
  Layer 2 is a separate, future MCP that fetches better posters
  from external catalogs (Mediux, ThePosterDB, Fanart.tv, TMDB
  images API) and feeds URLs into `plex_upload_poster`. Don't
  start until Layer 1 ships and we see how often external sourcing
  is actually needed vs. picking a better existing candidate.
  Kometa already handles bulk poster-overlay-config at scale —
  this is for the drive-by "this one specific item's poster looks
  bad, swap it" workflow that Kometa is wrong for.

- **Cross-MCP observations (not plex-mcp's repo, but adjacent).**
  - `servarr-mcp.sonarr_list_series` has no search-by-title.
    Finding Panty & Stocking required paging through 516
    records + Python dump-parsing. A `search` parameter or a
    dedicated `sonarr_find_series_by_title(term)` tool would
    cut this dramatically.
  - `servarr-mcp.sonarr_refresh_series` triggers only metadata
    refresh; the disk scan is opaquely chained on consecutive
    calls. A dedicated `sonarr_rescan_series` tool (Sonarr's
    own RescanSeries API command) would make the disk-scan
    intent explicit instead of relying on the
    "trigger refresh twice" pattern.
  - Sparse `fields` projection would help `sonarr_list_series`
    too — the 200-page-size response was 189k characters.

- **Token economy / agent efficiency (cross-MCP architectural
  pass).** The 2026-05-11 cleanup session burned through agent
  context fast. Retro on where the tokens went, ordered by
  impact-per-effort:
  1. **Sparse `fields` projection on `plex_get_item`** — by
     far the biggest single offender. Items with deep cast
     (WM42, SS) returned 80–100 KB **each**; ~90% was `Role[]`
     with hundreds of actor entries + thumb URLs, plus
     `Producer[]`, `Image[]`, `Stream[]` per Part, plus
     `UltraBlurColors`. Almost never needed; most calls wanted
     `Media.Part.file` and `Guid[]`. **~50-line change. Ship
     first.** Add a `minimal: true` shorthand that returns a
     curated operational-fields set so callers don't have to
     spell out the projection every time.
  2. **Same projection pattern across the MCP family.**
     `sonarr_list_series` (189 KB at page_size 200),
     `sonarr_list_episodes`, `radarr_list_movies`. All have
     the same shape problem.
  3. **Search-by-attribute tools eliminate paging.** Paged
     through 516 Sonarr records in 3 calls (~480 KB) to find
     one show; a server-side title match would have been one
     ~2 KB call. Concrete adds: `sonarr_find_series(term)`,
     `radarr_find_movie(term)`, `plex_find_in_section(section_id,
     title?, year?, has_match?)`.
  4. **Compound / bulk operations collapse N round-trips into
     1.** Patterns we hit repeatedly:
     - "Get N items by rk" → N separate `plex_get_item` calls →
       `plex_get_items_bulk(rating_keys[], fields=[...])`.
     - "What's the file path for rk X?" → full get_item to read
       one string → `plex_resolve_paths(rating_keys[])` returning
       just `{rk: file}`.
     - "Find duplicates" / "Find unmatched" → browse + per-item
       drill → `plex_find_duplicates(section_id)` and
       `plex_find_unmatched(section_id)` server-side.
  5. **Response hygiene defaults** (additive, no caller change):
     - Drop `UltraBlurColors` from every item (purely cosmetic,
       ~80 bytes × every browse hit).
     - `Image[]` duplicates the `thumb` / `art` paths already
       on the item — drop by default.
     - Cap `Role[]` at 10 by default, with `verbose=true` for
       full cast.
     - Collapse `Stream[]` to summary fields
       (`audio_codec` / `video_codec` / `resolution`) by default.
     - Trim `statistics.releaseGroups[]` on Sonarr/Radarr series
       records.
  6. **Self-verifying mutations** kill the post-action check
     round-trip. Currently the agent does `mutate → list →
     drill → verify`. If mutations return enough state inline,
     the verify call disappears: `plex_apply_match` returning
     `{guid, name, locked_fields, Guid[]}`; `plex_split_item`
     returning new rks with their `Media.Part.file` paths;
     `plex_edit_metadata` returning the full updated `Field[]`
     lock state; `sonarr_refresh_series` with an optional
     `wait: true` that completes after the disk-scan phase
     instead of forcing the "refresh twice" pattern.
  7. **Server `instructions` field as a free guardrail.** It's
     loaded into every session anyway. Add a token-economy
     note: "For audits, always pass `fields=[...]` to
     `plex_browse` / `plex_get_item`. Full-shape responses
     can run >50KB per item. Reserve full-shape calls for the
     one item you're about to act on." Agents read it and
     behave better at zero implementation cost.
- **CI integration tests are skipped by default.** Personal repo;
  if anyone wants CI to actually exercise the suite, they wire up
  their own Plex endpoint as GHA secrets. Decided not to do this
  for the canonical repo — the dev's local pre-commit run is the
  test gate.

## Open Decisions

None active. Decisions made during scaffolding:

- **Language:** TypeScript over Python. *Why:* most mature MCP SDK,
  user is on Windows and Node tooling is friction-free there.
- **Transport:** stdio. *Why:* MCP default; clients (Claude Desktop)
  invoke `docker run -i` and pipe stdin/stdout directly.
- **Plex client:** raw `fetch` against the Plex HTTP API, no SDK
  dependency. *Why:* small surface area, fewer transitive deps,
  Plex JSON API is straightforward.
- **Initial scope:** read-only browse + search. *Why:* covers the
  highest-value use cases (asking the assistant "what's on my Plex")
  without the risk of write operations.

## Known Gaps

- CI runs the test suite without `PLEX_URL`/`PLEX_TOKEN` (no GHA
  secrets configured), so the integration tests skip on every CI run.
  Tests must be exercised locally by the developer with `.env`
  loaded. **Decided to leave this as-is** for the canonical repo —
  it's a personal project and a CI-reachable Plex would mean either
  a public-facing Plex (token-on-the-internet risk) or a
  self-hosted runner (separate setup task). Forks of this repo can
  wire up their own CI as they see fit.
