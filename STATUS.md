# Status

**Last updated:** 2026-05-13

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

## Next

- **v0.6 scope (prioritized by audit-surfaced demand 2026-05-08).**
  In order of urgency:
  1. `plex_edit_metadata(ratingKey, fields={title?, titleSort?, …})` —
     `PUT /library/metadata/{key}?<field>.value=…&<field>.locked=1`.
     The `.locked=1` part is critical; without it a refresh wipes the
     override. Need: visual title fixes where the upstream TMDB
     title is technically right but awkward (year-doubling,
     missing-colon naming, etc.).
  2. `plex_unmatch(ratingKey)` — `PUT /library/metadata/{key}/unmatch`.
     Useful for forcing a clean re-match cycle or recovering from a
     bad `apply_match`.
  3. `plex_refresh_section(sectionId, force?)` —
     `GET /library/sections/{id}/refresh[?force=1]`. v0.5 only exposes
     per-item refresh; section-level rescan is needed after bulk
     filesystem changes.
  4. Sparse-projection `fields=` parameter on `plex_browse`. Every
     `plex_browse` against a populated section blew the output token
     cap during the audit and dumped to disk. Returning just
     `ratingKey,title,year,type` would shrink responses ~20×.
  5. (Speculative) `plex_split_item(ratingKey, mediaIds[])` for cases
     where Plex auto-grouped two legitimately-separate events under
     one item. Needs investigation against the web app's "Split
     Apart" call before committing to a tool shape.
- **Outstanding audit items needing v0.6 tools.**
  - WWE PPV `Money in the Bank 2025` (rk 207133) and
    `Backlash Tampa` (rk 208543) — title overrides blocked on tool #1
    above.
  - WWE PPV `SummerSlam 2025 Night 2` (rk 207172) — 11 files spanning
    both Saturday and Sunday were auto-grouped into one item; needs
    tool #5 or a filesystem-rename workaround.
  - WWE PPV `Royal Rumble 2026` triple-item (rk 206822 / 207232 /
    207233) — 207232 already re-matched to the canonical GUID;
    207233 was hook-blocked from a same-GUID re-match even after a
    preceding `plex_get_matches` confirmed the candidate.
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
