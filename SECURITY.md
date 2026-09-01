# Security Policy

## Supported Versions

Only the latest release receives security fixes — tracked by the `latest` tag
on [`ghcr.io/carldog/plex-mcp`](https://github.com/CarlDog/plex-mcp/pkgs/container/plex-mcp).
There is no LTS branch.

## Reporting a Vulnerability

Please report security issues privately using GitHub's
[Security Advisories](https://github.com/CarlDog/plex-mcp/security/advisories/new)
for this repository, rather than opening a public issue.

Expect an initial response within a few days. This is a solo-maintained
project — there's no formal SLA and no bounty, but reports are taken
seriously and fixes for confirmed issues are prioritized over other work.

## What has real impact here

`PLEX_TOKEN` is a Plex **account** token, not a per-server scoped key: it
authenticates as the account that issued it. Treat any path that could
disclose it as high impact.

The server is also **not read-only**. It can create, modify and delete
playlists, apply a metadata match with `plex_apply_match` (which overwrites an
item's agent binding), and write files to disk — `plex_save_image` under
`MCP_IMAGE_SAVE_DIR` and `plex_download_logs` under `MCP_LOG_SAVE_DIR`.
Anything in these classes is worth reporting:

- **Token exposure.** `PLEX_TOKEN` reaching tool output, an error message, or
  a log line. Plex puts the token in URLs, so a leak through an echoed request
  URL is the likely shape.
- **Path traversal on the write-to-disk tools.** `plex_save_image` and
  `plex_download_logs` take caller-influenced input and write bytes; an escape
  from `MCP_IMAGE_SAVE_DIR` / `MCP_LOG_SAVE_DIR` is a real finding.
- **Auth bypass on the HTTP transport.** `MCP_AUTH_TOKEN` gates `/mcp` and
  `MCP_ALLOWED_HOSTS` / `MCP_ALLOWED_ORIGINS` form the Host/Origin allowlist
  that blocks DNS rebinding from a browser on the host network. Binding
  loopback is *not* a substitute in a container — the container's loopback is
  its own, so the server binds `0.0.0.0` to be reachable at all.
- **A read-annotated tool that turns out to write.** Clients filter on
  `readOnlyHint` / `destructiveHint` to decide what needs confirmation, so an
  annotation that understates a tool is a security issue, not a docs bug.

## Deployment notes that are not vulnerabilities

Running with `MCP_AUTH_TOKEN` unset on a trusted network is an operator
choice; the server warns on startup. The self-signed certificate generated
into `MCP_TLS_DIR` on first start is for transport encryption on a LAN, not
identity — it will not validate, by design. The OAuth 2.1 path is scaffolding
and is documented as not yet practically usable.
