# Status

**Last updated:** 2026-05-11 (v0.8 candidates captured from extensive cleanup session)

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

## Next

- **v0.7 in flight (2026-05-13).**
  - **Shipped:** `plex_split_item` + `plex_merge_items` (commit
    `27f6d13`). Endpoints `PUT /library/metadata/{key}/split` and
    `PUT /library/metadata/{key}/merge?ids=<csv>`, both confirmed
    against `python-plexapi`'s `split_merge.py` mixin and live-probed.
    The audit's speculation that "Plex has no item-split primitive"
    was wrong — `split` is exactly what the web UI's "Split Apart"
    calls.
  - **Pending shipped-related operator actions:**
    - WWE SummerSlam 2025 Night 2 (rk 207172) — now solvable via
      `plex_split_item` to break the 11-file mis-grouping into
      separate items, then `plex_apply_match` on each.
    - WWE Royal Rumble 2026 triplicate (rk 206822 + 207232 +
      207233) — now solvable via `plex_merge_items(206822,
      [207232, 207233])`. Sidesteps the hook false-positive
      entirely (no `apply_match` involved).
  - **v0.7 additional candidates** (cross-validation 2026-05-13 against
    python-plexapi confirmed these endpoint shapes — see
    `docs/PLEX-API.md` cross-validation section):
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
