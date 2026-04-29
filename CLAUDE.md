# plex-mcp

MCP server for Plex Media Server, packaged as a Docker container.

## Status

Single source of truth: [STATUS.md](STATUS.md). Do not duplicate status
into this file, MEMORY.md, or Serena memories — reference STATUS.md.

## Current Sprint

**Phase: scaffolding** — see [STATUS.md](STATUS.md) for the active
phase, what's done, and what's next.

## Stack

- TypeScript (Node 22+, ESM, `NodeNext` module resolution)
- `@modelcontextprotocol/sdk` (high-level `McpServer` API)
- `zod` for tool input schemas
- Plex HTTP API via `fetch` (no Plex SDK dependency)
- Docker multi-stage build (alpine, non-root)

## Layout

- `src/index.ts` — MCP server entry point, registers tools, stdio transport
- `src/plex.ts` — Plex HTTP API client
- `Dockerfile` — multi-stage build for the runtime image
- `.githooks/pre-commit` — gitleaks scan (activate with `git config core.hooksPath .githooks`)
- `.gitleaks.toml` — secret-scanning config

## Common Commands

```bash
npm install            # install deps
npm run build          # tsc → dist/
npm run dev            # tsx src/index.ts (requires PLEX_URL, PLEX_TOKEN)
npm run typecheck      # tsc --noEmit
docker build -t plex-mcp .
```

## Conventions

- All logging goes to **stderr** (`console.error`). stdout is the MCP
  wire protocol — writing to it corrupts the transport.
- Tool names use `plex_` prefix and snake_case.
- Tool inputs validated with `zod`. Outputs returned as a single
  JSON-stringified text content block.
- Plex auth via env vars `PLEX_URL` and `PLEX_TOKEN`. The container is
  stateless; the token never lands on disk in the image.

## Testing

No tests yet. When added, integration tests against a real Plex server
behind an env-gated test (don't mock the Plex API — see working-style
note about mocked-vs-real divergence).
