# plex-mcp

<!-- fleet-confidence -->
![code confidence](https://img.shields.io/badge/code_confidence-fair-orange) <sub>· `claude-opus-4-8[1m]` · 2026-07-07 · [details](https://github.com/CarlDog/plex-mcp/issues/1)</sub>
<!-- /fleet-confidence -->


An [MCP](https://modelcontextprotocol.io) server for
[Plex Media Server](https://www.plex.tv/), packaged as a Docker
container. Lets an MCP client (Claude Desktop, etc.) browse and search
your Plex libraries.

## Tools

| Tool | Description |
| --- | --- |
| `plex_list_libraries` | List all libraries (sections) on the server |
| `plex_search` | Search across all libraries |
| `plex_hub_search` | Search via Plex's hub-search endpoint, including collections (unlike `plex_search`) |
| `plex_recently_added` | Recently added items, optionally per-section |
| `plex_on_deck` | Items "on deck" (partially watched / next up); optional `section_id` scopes to one library section |
| `plex_get_item` | Metadata for one item by rating key. Pass `minimal=true` to drop bulky cast/crew/image arrays (~80% size reduction on movies with deep casts) while keeping subtitle-track info; pass `fields=[...]` for explicit projection |
| `plex_browse` | List items in a library section (paged, optional type filter, optional `collection` title filter, optional sparse `fields` projection) |
| `plex_list_collections` | List collections in a library section (thin wrapper over `plex_browse`'s collection type) |
| `plex_get_children` | Children of an item (show→seasons, season→episodes, artist→albums) |
| `plex_now_playing` | Currently-playing sessions on the server |
| `plex_history` | Playback history entries (paged, most recent first) |
| `plex_mark_watched` | Mark an item as watched (reversible) |
| `plex_mark_unwatched` | Mark an item as unwatched (reversible) |
| `plex_rate_item` | Set an item's 0-10 user star rating; omit `rating` to clear it back to unrated |
| `plex_remove_from_continue_watching` | Remove an item from the Continue Watching hub without touching its watch progress; reappears automatically once resumed |
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
| `plex_save_image` | Same input surface as `plex_get_image`, but WRITES the bytes to disk under `MCP_IMAGE_SAVE_DIR` (default `/data/images/`) and returns the path + size. Bind-mount a host directory onto that path to bridge to a downstream pipeline (ImageMagick, filesystem-mcp consumer, etc.) without a vision render. |
| `plex_download_logs` | Fetch Plex's diagnostic ZIP under `MCP_LOG_SAVE_DIR`; on Plex 5xx/transport failure, copy the primary server log from the read-only filesystem fallback mount |
| `plex_list_posters` | List every poster candidate for an item (agent-supplied, locally-scanned, previously uploaded), including which one is currently active |
| `plex_set_poster` | Select an existing poster candidate as the active one, by the candidate's own `poster_rating_key` from `plex_list_posters` |
| `plex_upload_poster` | Add a new poster from an external URL (Plex fetches it) or a local file under `MCP_IMAGE_SAVE_DIR`. Auto-selects it by default; `select=false` adds it without changing what's displayed |
| `plex_tautulli_status` | Optional Tautulli configuration and on-demand connectivity status; never affects `/health` |
| `plex_tautulli_activity` | Normalized current Tautulli sessions with email, IP, machine-id, and file-path fields omitted |
| `plex_tautulli_history` | Paged, filtered Tautulli watch history with sensitive network/filesystem fields omitted |
| `plex_tautulli_watch_time` | Library play-count and watch-time totals for selected day windows |

The Tautulli tools are always registered so MCP capability caches stay stable.
`plex_tautulli_status` reports disabled or incomplete configuration normally;
the three data tools return a bounded tool error when Tautulli is unavailable.
They use a direct repository-local client and never participate in `/health`.

## Configuration

Two environment variables, both required:

| Var | Example | Notes |
| --- | --- | --- |
| `PLEX_URL` | `http://192.168.1.50:32400` | Base URL of your Plex server |
| `PLEX_TOKEN` | *(see below)* | Plex auth token |

To find your Plex token, see Plex's
[Finding an authentication token](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)
guide.

### Optional environment variables

All have working defaults; set only to override.

| Var | Default | Notes |
| --- | --- | --- |
| `MCP_FETCH_TIMEOUT_MS` | `30000` | Timeout for every outbound Plex request except log downloads |
| `MCP_IMAGE_MAX_BYTES` | `4194304` (4 MiB) | Size cap for `plex_get_image`/`plex_save_image` |
| `MCP_LOG_MAX_BYTES` | `52428800` (50 MiB) | Size cap for `plex_download_logs` |
| `MCP_LOG_FETCH_TIMEOUT_MS` | `120000` (2 min) | Timeout for `plex_download_logs` — separate from `MCP_FETCH_TIMEOUT_MS` since a log ZIP has a different size/latency profile |
| `MCP_PLEX_LOG_SOURCE_DIR` | `/plex-logs` | In-container read-only directory containing `Plex Media Server.log` for 5xx/transport fallback |
| `MCP_SESSION_IDLE_TIMEOUT_MS` | `3600000` (1 hr) | Evicts an HTTP-mode MCP session after this much inactivity |
| `TAUTULLI_URL` | unset | Optional Tautulli web root, including any HTTP root. Unset with `TAUTULLI_API_KEY` disables the integration. |
| `TAUTULLI_API_KEY` | unset | Optional Tautulli API key. Required only when `TAUTULLI_URL` is set; never returned or logged. |
| `TAUTULLI_TIMEOUT_MS` | `10000` | Timeout for each optional Tautulli request. Tautulli failures do not affect Plex tools or `/health`. |

`LOG_LEVEL`, `MCP_ALLOWED_HOSTS`/`MCP_ALLOWED_ORIGINS`, and
`HOST_IMAGE_DIR`/`HOST_LOG_DIR`/`HOST_PLEX_LOG_SOURCE_DIR` are covered in their own sections below
(Logging, HTTP transport hardening, Portainer deploy) since each needs
more than a one-line note.

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

### OAuth 2.1 bearer-token auth (opt-in, not yet practically usable)

Code-side support for OAuth 2.1 protected-resource auth exists
(ChatGPT Apps SDK alignment Phase 2 — see
[docs/CHATGPT-APPS-SDK.md](docs/CHATGPT-APPS-SDK.md) for the full
plan), but **isn't yet something you can actually turn on and use**:
it needs a real OAuth 2.1 identity provider issuing tokens, and none
is provisioned for this deployment (that's Phase 3, not started).
Documented here for completeness, not as a how-to.

| Var | Notes |
| --- | --- |
| `MCP_OAUTH_ISSUER` | IdP issuer URL. Setting this opts in to auth — unset (default) means no-auth, identical to today's behavior. |
| `MCP_OAUTH_AUDIENCE` | Required once `MCP_OAUTH_ISSUER` is set. Expected `aud` claim — should equal this server's canonical public URL. Server refuses to start if missing. |
| `MCP_OAUTH_REQUIRED_SCOPES` | Comma-separated. Default `plex:read`. |

When enabled, every `/mcp` request needs `Authorization: Bearer
<jwt>` — issued by the configured IdP, with the right audience and
scope. `/health` is never affected (a separate route, and Docker's
own healthcheck has no way to attach a bearer token). `/.well-known/oauth-protected-resource`
is served automatically per RFC 9728.

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
export MCP_ALLOWED_HOSTS=nas.local:3001  # required — see below
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
4. Environment variables: set `PLEX_URL`, `PLEX_TOKEN`,
   `MCP_ALLOWED_HOSTS`, `HOST_IMAGE_DIR`, and `HOST_LOG_DIR` — all
   **required** (see below); optionally set `HOST_PORT` and the Tautulli pair
   `TAUTULLI_URL`/`TAUTULLI_API_KEY` (`TAUTULLI_TIMEOUT_MS` defaults to
   `10000`). Leaving both Tautulli values unset disables that integration.
5. Deploy. Healthcheck reaches green within ~10 seconds.

### `MCP_ALLOWED_HOSTS` is required in HTTP mode

Comma-separated list of `Host` header values the server accepts on
`/mcp` — e.g. `nas.local:3001` (must match whatever host:port a client
actually dials, including the mapped `HOST_PORT`). The server refuses
to start in HTTP mode without it, and `docker compose config` fails
the same way if it's unset — both fail before the container ever
comes up, deliberately, rather than starting in a silently-unprotected
state.

This exists because binding `0.0.0.0` inside a container isn't a real
access boundary the way loopback binding is on a bare host: a page
loaded in a browser anywhere on the LAN can perform DNS rebinding —
pointing its own hostname at this container's IP — and drive tools
(including writes like `plex_delete_playlist`) as a confused deputy,
entirely bypassing "LAN-only, no bearer token" as a security posture.
The Host allowlist closes that gap without requiring full
authentication. `MCP_ALLOWED_ORIGINS` (optional, default empty) does
the same for the `Origin` header — leave it unset unless a
browser-based client legitimately needs to call this server directly;
non-browser clients (the `mcp-remote` bridge, a direct `fetch`) never
send an `Origin` header, so the empty default only ever rejects the
request shape a DNS-rebinding attack actually sends.

### Host image, log-output, and Plex log-source directories are required

All three volume host paths are `${VAR:?...}` in the compose file: **there
is no fallback default**, so `docker compose up` / a Portainer
redeploy fails fast with a clear error if either is unset, rather than
starting in a broken state.

This used to be a soft `${VAR:-./data/images}` default, which is only
safe for a local `docker compose up` from a stable clone. In a
Portainer git stack it's a trap: every redeploy clones the repo into a
fresh per-commit directory (`/data/compose/<stack-id>/<commit>/`),
where a relative path like `./data/images` doesn't exist. Docker
refused the bind mount and the container was left stuck in `created`
state — it never started. That also hit *automatic* redeploys (image
update, git poll), so a previously healthy stack went down with no
manual action; the only symptom was the container sitting in
`created`. This took the deployed stack down for ~10 hours on
2026-07-31 — see `docker-deployments.md` rule #10 and fleet lesson
`2026-07-31-relative-compose-volume-defaults-break-portainer-git-stacks`.
The compose file now makes the requirement structural instead of a
documentation-only convention.

Set all three to **absolute host paths** in the stack's environment
variables:

- `HOST_IMAGE_DIR` — the `plex_save_image` output directory.
  Recommended: the host directory backing filesystem-mcp's
  `/media/_mcp-scratch` mount — e.g. `/volume1/Media/_mcp-scratch` on
  a Synology NAS — which keeps the `plex_search → plex_save_image →
  filesystem-mcp` pipeline on one shared directory.
- `HOST_LOG_DIR` — the `plex_download_logs` output directory, kept
  separate from `HOST_IMAGE_DIR` since a diagnostic ZIP isn't a media
  artifact — e.g. `/volume1/docker/plex-mcp/logs` on a Synology NAS
  (matching this fleet's per-container appdata convention).
- `HOST_PLEX_LOG_SOURCE_DIR` — Plex's existing server-log directory,
  mounted read-only for API-outage fallback. On this Synology package it
  is `/volume1/docker/plex/Library/Application Support/Plex Media Server/Logs`.

Make sure all three directories exist on the host **before** the first
deploy: Docker does not auto-create a missing bind-mount source, it
just refuses to start the container.

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
MCP_PORT=3000 MCP_ALLOWED_HOSTS=localhost:3000 PLEX_URL=... PLEX_TOKEN=... npm run dev # HTTP
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
