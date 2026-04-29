# Status

**Last updated:** 2026-04-29

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

## Next

- Add tests once a real Plex test target is set up (don't mock).
- v0.3 scope to plan: playlists (list/CRUD), Plex hubs (Continue
  Watching / Top Picks), maybe ratings + edit-metadata.

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

- No tests yet.
