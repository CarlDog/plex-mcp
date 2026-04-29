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

## Run with Docker

```bash
docker build -t plex-mcp .
docker run -i --rm \
  -e PLEX_URL=http://192.168.1.50:32400 \
  -e PLEX_TOKEN=your-token \
  plex-mcp
```

## Use with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "plex": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "PLEX_URL",
        "-e", "PLEX_TOKEN",
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

## Local development

```bash
npm install
cp .env.example .env  # then edit
PLEX_URL=... PLEX_TOKEN=... npm run dev
```

## Security

- The container runs as a non-root user (`plexmcp`).
- The Plex token is passed via env var — never bake it into the image.
- A `.githooks/pre-commit` runs gitleaks on every commit. Activate it
  once per clone: `git config core.hooksPath .githooks`
