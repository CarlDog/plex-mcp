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
| `plex_browse` | List items in a library section (paged, optional type filter, optional sparse `fields` projection) |
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
| `plex_refresh_metadata` | Re-pull metadata for an item from its current agent (optional `force`) |
| `plex_get_matches` | List candidate matches for an item (TMDB / TVDB / etc.); optional title/year/agent/language overrides |
| `plex_apply_match` | Apply a chosen match (`guid`/`name`) to an item; overwrites the agent binding |
| `plex_edit_metadata` | Override scalar metadata fields (title, summary, year, etc.) with field-level locking |
| `plex_unmatch` | Detach an item from its agent binding (back to unmatched state); locked fields survive |
| `plex_refresh_section` | Trigger a metadata refresh for an entire library section (incremental or deep) |
| `plex_split_item` | Split a Plex item back into its constituent media variants as N separate items |
| `plex_merge_items` | Merge other items INTO a target item (sources absorbed; target survives) |
| `plex_get_image` | Fetch poster/art/banner/clearLogo bytes for an item as an MCP image content block (so vision-capable clients can actually see the picture); optional max_width/max_height routes through Plex's transcoder |

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

> HTTP mode has **no caller authentication** — TLS (below) encrypts
> traffic but doesn't identify the caller. Bind only to a private
> network. Rely on host firewall or LAN isolation. Don't expose to the
> public internet without adding bearer-token auth first.

### Enabling HTTPS

HTTPS is opt-in. Resolution order at startup:

1. **Bring-your-own cert** — set both `MCP_TLS_CERT_FILE` and
   `MCP_TLS_KEY_FILE` to PEM file paths. Use this when terminating
   Let's Encrypt or an internal CA. The server reads them at startup;
   restart the container to pick up renewed files.
2. **Self-managed cert** (recommended for LAN-only setups) — set
   `MCP_TLS=auto`. The server generates an ECDSA P-256 self-signed
   cert on first start, writes it to `MCP_TLS_DIR` (default
   `/data/certs`), and reuses it on subsequent starts. When the cert
   is within 30 days of expiry it's regenerated automatically.
3. Otherwise the server stays on plain HTTP (today's default).

| Var | Default | Notes |
| --- | --- | --- |
| `MCP_TLS` | unset | `auto` / `true` / `on` / `1` to enable self-managed mode |
| `MCP_TLS_DIR` | `/data/certs` | Where `server.crt` / `server.key` live. Mount a volume to persist. |
| `MCP_TLS_SAN` | `DNS:localhost,IP:127.0.0.1` | Subject Alternative Names. Comma-separated `DNS:` / `IP:` entries. |
| `MCP_TLS_CN` | first DNS SAN, else `plex-mcp` | Certificate common name. |
| `MCP_TLS_DAYS` | `365` | Validity period. Cert rotates when <30 days remain. |
| `MCP_TLS_CERT_FILE` | unset | BYO cert (PEM). Overrides `MCP_TLS=auto` when set together with the key. |
| `MCP_TLS_KEY_FILE` | unset | BYO key (PEM). |

On startup the server logs the cert's SHA-256 fingerprint and
`notAfter`. Pin the fingerprint client-side, or trust the cert in
your OS keystore for browsers and CLI tools.

When TLS is on, the compose healthcheck needs the
`--no-check-certificate` flag — update the `test:` line to
`["CMD", "wget", "--no-check-certificate", "-q", "-O-", "https://localhost:3000/health"]`.

#### Pointing `mcp-remote` at an HTTPS endpoint

For a self-signed cert, either pin the cert file via Node's CA bundle
or skip verification on the client (LAN-only):

```bash
# Trust the server's self-signed cert (preferred):
NODE_EXTRA_CA_CERTS=./server.crt \
  npx -y mcp-remote https://nas.local:3443/mcp

# Or skip verification for quick testing (LAN-only):
NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx -y mcp-remote https://nas.local:3443/mcp
```

#### Reverse-proxy alternative

In-process TLS is convenient when you don't already run an ingress
controller. If you have Caddy, Traefik, or nginx in front of your
home services, the more idiomatic pattern is to terminate TLS at
the proxy (with automatic Let's Encrypt) and keep `plex-mcp` on
plain HTTP behind it. The two approaches are interchangeable — pick
whichever matches your existing setup.

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
