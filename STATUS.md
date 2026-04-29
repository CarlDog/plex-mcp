# Status

**Last updated:** 2026-04-28

## Phase

HTTP transport added (pilot for the `*-mcp` family). Same image now
supports stdio and Streamable HTTP, selected by the `MCP_PORT` env var.
`docker-compose.yml` added for Portainer/Compose deployment. Pending
live smoke test of HTTP path against a real Plex server.

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

## Next

- Smoke-test the HTTP transport: `docker compose up --build` against a
  real Plex server, hit `/mcp` with the MCP Inspector or curl, verify
  the tool roundtrip.
- Smoke-test stdio path still works post-refactor: `docker run -i --rm
  -e PLEX_URL=... -e PLEX_TOKEN=... plex-mcp`.
- Deploy to the Synology NAS via Portainer (Stack from Git URL pointing
  at this repo); confirm container becomes healthy and is reachable on
  the LAN.
- Replicate the same diff to `servarr-mcp` and `downloader-mcp` once the
  pilot is proven.
- After deployment is solid: decide on playback control / library-mgmt
  tools (still out of scope).

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

- No tests yet
- No CI yet
- No published Docker image yet (would publish to GHCR or Docker Hub
  after smoke tests)
- MCP SDK version pinned to `^1.0.0` — verify against latest release
  on first `npm install`
