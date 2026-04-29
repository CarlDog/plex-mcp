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

## Configuration

Two environment variables, both required:

| Var | Example | Notes |
| --- | --- | --- |
| `PLEX_URL` | `http://192.168.1.50:32400` | Base URL of your Plex server |
| `PLEX_TOKEN` | *(see below)* | Plex auth token |

To find your Plex token, see Plex's
[Finding an authentication token](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)
guide.

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

```bash
# Required env vars (or use a .env file):
export PLEX_URL=http://192.168.1.50:32400
export PLEX_TOKEN=your-token
export HOST_PORT=3001  # optional, defaults to 3001

docker compose up --build
```

The MCP endpoint will be at `http://<host>:${HOST_PORT}/mcp`.

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

## Security

- The container runs as a non-root user (`plexmcp`).
- The Plex token is passed via env var — never bake it into the image.
- A `.githooks/pre-commit` runs gitleaks on every commit. Activate it
  once per clone: `git config core.hooksPath .githooks`
