# Status

**Last updated:** 2026-05-18 (deploy verified end-to-end; bind
mount `/volume1/Media/_mcp-scratch:/data/images:rw` active on the
stack; `plex_save_image → fs_stat` round-trip proved with a real
Young Guns II poster (240,332 bytes). PLEX-API.md gained the
`/photo/:/transcode` width+height gotcha + an endpoints-table row
each for plex_get_image and plex_save_image. v0.8 queue reordered:
plex_upload_poster moved up to next-to-ship because today's
poster-workflow handoff with Claude Desktop confirms the round-trip
needs an upload side to complete the loop. Yesterday's work (v0.7.0
release + v0.7.1 patch + plex_get_image + plex_get_item projection +
tool annotations + plex_save_image) all live and serving.)

## Phase

Deployed and verified — running on the NAS at
`http://carldog-nas:3001/mcp`. HTTP transport pilot for the `*-mcp`
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
  own hostname, so the previous `PLEX_URL=http://carldog-nas:32400`
  failed at fetch time inside the container.
- **Wired into Claude Desktop** via `mcp-remote` bridge
  (`npx -y mcp-remote http://carldog-nas:3001/mcp --allow-http`).
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
