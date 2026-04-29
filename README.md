# plex-mcp

An [MCP](https://modelcontextprotocol.io) server for
[Plex Media Server](https://www.plex.tv/), packaged as a Docker
container. Lets an MCP client (Claude Desktop, etc.) browse and search
your Plex libraries.

## Tools

| Tool | Description |
| --- | --- |
| `plex_list_libraries` | List all libraries (sections) on the server |
| `plex_search` | Search across all libraries |
| `plex_recently_added` | Recently added items, optionally per-section |
| `plex_on_deck` | Items "on deck" (partially watched / next up) |
| `plex_get_item` | Full metadata for one item by rating key |
| `plex_browse` | List items in a library section (paged, optional type filter) |
| `plex_get_children` | Children of an item (show→seasons, season→episodes, artist→albums) |
| `plex_now_playing` | Currently-playing sessions on the server |
| `plex_history` | Playback history entries (paged, most recent first) |
| `plex_mark_watched` | Mark an item as watched (reversible) |
| `plex_mark_unwatched` | Mark an item as unwatched (reversible) |
| `plex_list_playlists` | List all playlists (regular + smart) |
| `plex_get_playlist_items` | List a playlist's contents |
| `plex_create_playlist` | Create a regular playlist seeded with one item |
| `plex_add_to_playlist` | Append an item to a regular playlist |
| `plex_remove_from_playlist` | Remove an item by `playlistItemID` |
| `plex_delete_playlist` | Delete a playlist (metadata only — media untouched) |
| `plex_hubs` | Plex's curated server-wide hubs (Continue Watching, Recently Released, etc.) |
| `plex_section_hubs` | Curated hubs scoped to one library section |
| `plex_related` | Plex's curated "related" hubs for an item (provenance-grouped) |
| `plex_similar` | Algorithmic similar items for an item (flat list) |

## Configuration

Two environment variables, both required:

| Var | Example | Notes |
| --- | --- | --- |
| `PLEX_URL` | `http://192.168.1.50:32400` | Base URL of your Plex server |
| `PLEX_TOKEN` | *(see below)* | Plex auth token |

To find your Plex token, see Plex's
[Finding an authentication token](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)
guide.

> **Plex on the same host as the container?** Use
> `PLEX_URL=http://host.docker.internal:32400`. The compose file maps
> `host.docker.internal` to the Docker host gateway via `extra_hosts`,
> so the container can reach a Plex server running on the host. The
> host's own hostname (e.g. `my-nas`) won't resolve from inside the
> container without that mapping.

## Transport modes

| Mode | When to use | How to start |
| --- | --- | --- |
| **stdio** (default) | Direct invocation by Claude Desktop / MCP clients | `docker run -i --rm ... plex-mcp` (no `MCP_PORT`) |
| **Streamable HTTP** | Long-lived deployment (Portainer, Compose, k8s) | Set `MCP_PORT=3000` (already done in `docker-compose.yml`) |

In HTTP mode the server exposes:
- `POST/GET/DELETE /mcp` — MCP Streamable HTTP endpoint (per spec)
- `GET /health` — liveness probe (used by docker healthcheck)

> HTTP mode currently has **no auth**. Bind only to a private network.
> Rely on host firewall or LAN isolation. Don't expose to the public
> internet without adding bearer-token auth first.

## Run with Docker (stdio, on demand)

```bash
docker build -t plex-mcp .
docker run -i --rm \
  -e PLEX_URL=http://192.168.1.50:32400 \
  -e PLEX_TOKEN=your-token \
  plex-mcp
```

## Run with Docker Compose (HTTP, long-lived)

The compose file pulls `ghcr.io/carldog/plex-mcp:latest` (multi-arch:
linux/amd64 + linux/arm64), published by CI on every push to `main`.

```bash
# Required env vars (or use a .env file):
export PLEX_URL=http://192.168.1.50:32400
export PLEX_TOKEN=your-token
export HOST_PORT=3001  # optional, defaults to 3001

docker compose up
```

The MCP endpoint will be at `http://<host>:${HOST_PORT}/mcp`.

To rebuild from source instead of pulling:

```bash
docker build -t ghcr.io/carldog/plex-mcp:latest .
docker compose up
```

## Deploy via Portainer (Stack from Git)

1. In Portainer, *Stacks → Add Stack → Repository*.
2. Repository URL: `https://github.com/CarlDog/plex-mcp`
3. Compose path: `docker-compose.yml`
4. Environment variables: set `PLEX_URL`, `PLEX_TOKEN`, optionally `HOST_PORT`.
5. Deploy. Healthcheck reaches green within ~10 seconds.

## Use with Claude Desktop

### stdio (local invocation)

```json
{
  "mcpServers": {
    "plex": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "PLEX_URL", "-e", "PLEX_TOKEN",
        "plex-mcp"
      ],
      "env": {
        "PLEX_URL": "http://192.168.1.50:32400",
        "PLEX_TOKEN": "your-token"
      }
    }
  }
}
```

### HTTP (remote MCP server)

```json
{
  "mcpServers": {
    "plex": {
      "url": "http://nas.local:3001/mcp"
    }
  }
}
```

(Requires Claude Desktop or a client that supports remote MCP HTTP.)

## Local development

```bash
npm install
cp .env.example .env  # then edit
PLEX_URL=... PLEX_TOKEN=... npm run dev               # stdio
MCP_PORT=3000 PLEX_URL=... PLEX_TOKEN=... npm run dev # HTTP
```

## Logging

The server emits structured logs to **stderr** (stdout is the MCP
wire protocol in stdio mode and must not be polluted). Format:

```
2026-04-29T15:30:00.000Z INFO [tool:plex_browse] invoke section_id=7 type=show limit=2
2026-04-29T15:30:00.337Z INFO [tool:plex_browse] ok ms=337
```

Configure verbosity via the `LOG_LEVEL` env var (default `info`):

| Level | Shows |
|---|---|
| `error` | Errors only |
| `warn` | + 4xx Plex responses |
| `info` (default) | + Tool invocations and completions |
| `debug` | + Every Plex API call with method, path, status, ms |
| `trace` | (reserved) |

Container logs are captured by Docker's `json-file` driver and
rotated automatically (10MB × 3 files = ~30MB cap; oldest deleted
on rotation). View with `docker logs plex-mcp` or `docker logs -f`.

## Security

- The container runs as a non-root user (`plexmcp`).
- The Plex token is passed via env var — never bake it into the image.
- A `.githooks/pre-commit` runs gitleaks on every commit. Activate it
  once per clone: `git config core.hooksPath .githooks`
