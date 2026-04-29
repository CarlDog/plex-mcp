# Codebase structure

```
plex-mcp/
├── src/
│   ├── index.ts        # MCP server entry — registers tools, stdio transport
│   └── plex.ts         # Plex HTTP API client (fetch-based)
├── dist/               # tsc output — gitignored
├── .githooks/
│   └── pre-commit      # gitleaks scan (activate via core.hooksPath)
├── Dockerfile          # multi-stage: build → runtime (alpine, non-root)
├── package.json        # type: module, ESM
├── tsconfig.json       # strict + noUncheckedIndexedAccess
├── .gitignore          # excludes node_modules, dist, .env, *.pem, *.key, etc.
├── .gitleaks.toml      # secret-scan config with venv/node_modules exclusions
├── .dockerignore
├── .env.example        # PLEX_URL, PLEX_TOKEN placeholders
├── CLAUDE.md           # project instructions for Claude
├── STATUS.md           # single source of truth for project status
└── README.md           # public-facing docs
```

**Tools currently registered** (all read-only):
- `plex_list_libraries`
- `plex_search`
- `plex_recently_added`
- `plex_on_deck`
- `plex_get_item`

Adding a tool: add a method to `PlexClient` in `src/plex.ts`, then a
`server.registerTool(...)` call in `src/index.ts`. Inputs use `zod`
schemas; outputs go through the `asText()` helper.
