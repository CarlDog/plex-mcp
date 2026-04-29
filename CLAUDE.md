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

- `src/index.ts` — MCP server entry. Decides transport based on `MCP_PORT`.
- `src/plex.ts` — Plex HTTP API client.
- `Dockerfile` — multi-stage build for the runtime image.
- `docker-compose.yml` — Compose/Portainer deployment using HTTP transport.
- `.githooks/pre-commit` — gitleaks + PII pattern scan.
- `.gitleaks.toml` — secret-scanning config.

## When to add a `tools/` layer

Today the structure is flat: `src/plex.ts` holds the API client and
`src/index.ts` registers tools inline (inside `createServer()`). That's
idiomatic when each tool is a thin wrapper over a single API call.

**Trigger to refactor:** the first tool that doesn't fit cleanly inline
in `index.ts`. Concretely:

- A tool that does **non-trivial composition** of multiple Plex API
  calls — cross-references, ranking, filtering beyond what the API
  exposes natively (e.g. "what should I watch tonight" combining
  on-deck + watch history + recently added with custom logic).
- Adding a **second integration** (e.g. Tautulli for stats). At that
  point one-file-per-integration plus a `src/tools/` directory becomes
  the natural shape.

When that moment arrives, pull tool registrations out of `index.ts`
into `src/tools/<descriptive-name>.ts`. Mechanical refactor.

Don't pre-split before that trigger. Three similar lines is better than
a premature abstraction — and the right split shape is easier to see
once the first complex tool exists than before.

## Transport modes

The same image supports two transports, selected at start time:

- **stdio (default)** — used when `MCP_PORT` is unset. The server reads
  MCP wire from stdin and writes to stdout. This is the standard mode
  for `docker run -i` invocation by an MCP client (Claude Desktop, etc.).
- **HTTP (Streamable HTTP)** — used when `MCP_PORT` is set to a port
  number. The server listens on `0.0.0.0:$MCP_PORT` with two endpoints:
  - `POST/GET/DELETE /mcp` — MCP Streamable HTTP per spec; per-session
    `mcp-session-id` header. Clients initialize via `POST /mcp` (no
    session header) which mints a UUID; subsequent requests reuse it.
  - `GET /health` — liveness probe (used by docker healthcheck).

  Per-session McpServer instances are created via the `createServer()`
  factory; the shared `PlexClient` is module-scope.

The two modes are mutually exclusive in a given process.

## Common Commands

```bash
npm install            # install deps
npm run build          # tsc → dist/
npm run dev            # tsx src/index.ts (requires PLEX_URL, PLEX_TOKEN)
npm run typecheck      # tsc --noEmit
docker build -t plex-mcp .

# stdio (manual smoke test):
docker run -i --rm -e PLEX_URL=... -e PLEX_TOKEN=... plex-mcp

# HTTP (compose-style):
docker compose up --build
```

## Conventions

- All logging goes to **stderr** (`console.error`). In stdio mode,
  stdout is the MCP wire protocol — writing to it corrupts the
  transport. Even in HTTP mode, keep logs on stderr for consistency.
- Tool names use `plex_` prefix and snake_case.
- Tool inputs validated with `zod`. Outputs returned as a single
  JSON-stringified text content block.
- Plex auth via env vars `PLEX_URL` and `PLEX_TOKEN`. The container is
  stateless; the token never lands on disk in the image.
- HTTP mode currently has **no auth** — bind only to private networks.
  Rely on host firewall / LAN isolation. Add a bearer token if ever
  exposed beyond a trusted network.

## Testing

No tests yet. When added, integration tests against a real Plex server
behind an env-gated test (don't mock the Plex API — see working-style
note about mocked-vs-real divergence).

## MCP tooling (local workstation)

This repo is registered with two MCP servers for Claude Code sessions
opened in this directory:

- **Serena** — user-scoped (available in every project on this machine).
  Project memories are written under the `plex-mcp` Serena project.
  Re-onboarding isn't needed; if memories drift, update them with
  `mcp__serena__write_memory`.
- **OpenChronicle** — registered at *local scope* for this directory
  via `claude mcp add openchronicle -- oc mcp serve`. Effective for
  future Claude Code sessions opened with cwd = repo root. Config lives
  in `~/.claude.json` under the project entry — not committed.

If you re-clone the repo on another machine, re-register OpenChronicle
with the same command. Serena will work automatically if it's already
user-scoped on that machine.
