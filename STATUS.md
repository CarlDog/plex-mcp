# Status

**Last updated:** 2026-04-28

## Phase

Scaffolding — initial repo structure created, not yet built or tested
end-to-end.

## Done

- Repo initialized with TypeScript + MCP SDK + Plex HTTP client skeleton
- Five read-only tools defined: `plex_list_libraries`, `plex_search`,
  `plex_recently_added`, `plex_on_deck`, `plex_get_item`
- Multi-stage Dockerfile (alpine, non-root user)
- Security baseline: `.gitignore`, `.gitleaks.toml`, `.githooks/pre-commit`
- Project docs: CLAUDE.md, STATUS.md, README.md

## Next

- `npm install` and verify `npm run build` succeeds
- Smoke-test against a real Plex server (set `PLEX_URL`/`PLEX_TOKEN`,
  run `npm run dev`, exercise via an MCP client)
- Build the Docker image and verify `docker run -i` connects via stdio
- Wire into Claude Desktop config and verify the tools call through
- After smoke test passes: decide on whether to add playback control
  tools and library-management tools (currently out of scope)

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
