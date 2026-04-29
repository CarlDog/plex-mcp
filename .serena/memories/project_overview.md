# plex-mcp — project overview

**Purpose:** MCP (Model Context Protocol) server that exposes a Plex
Media Server's libraries to MCP clients (Claude Desktop, etc.) for
browsing and search. Packaged as a Docker container.

**Status:** See `STATUS.md` in the repo root — single source of truth.
Do not duplicate status here.

**Tech stack**
- TypeScript (Node 22+, ESM, `NodeNext` module resolution)
- `@modelcontextprotocol/sdk` v1.x — high-level `McpServer` API
- `zod` for tool input schemas
- Plex HTTP API accessed directly via `fetch` (no Plex SDK dependency)
- Multi-stage Docker build (alpine base, non-root user `plexmcp`)

**Transport:** stdio. MCP clients invoke `docker run -i --rm ...` and
pipe stdin/stdout to the container as the MCP wire.

**Auth:** Plex token via env vars `PLEX_URL` and `PLEX_TOKEN`. Stateless
container — no token persisted to disk.

**Repo:** https://github.com/CarlDog/plex-mcp (public — upstream)

**Git author convention:** set the local repo author to a no-reply
email (e.g. GitHub's `<numeric-id>+<username>@users.noreply.github.com`
pattern) so personal email never lands in public commit metadata.
Configure per-repo, not globally — verify with `git config user.email`
before the first commit.
