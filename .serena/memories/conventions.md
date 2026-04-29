# Conventions

## MCP-specific (CRITICAL)

- **stdout is the MCP wire protocol.** Never `console.log` —
  it corrupts the transport. All logging goes to **stderr** via
  `console.error`. This applies to dependencies too — be wary of
  libraries that log to stdout by default.
- Tool names: `plex_` prefix, `snake_case` (e.g. `plex_recently_added`).
- Tool inputs: validated with `zod` schemas. Use `.describe(...)` on
  every field — descriptions surface to the LLM caller.
- Tool outputs: a single text content block with JSON-stringified
  payload. Use the `asText()` helper in `src/index.ts`.
- Errors: thrown from `PlexClient` propagate; the MCP SDK wraps them.
  Don't swallow errors silently.

## TypeScript

- ESM only (`"type": "module"`). Imports use `.js` extension even when
  importing `.ts` files (NodeNext convention).
- `strict: true` + `noUncheckedIndexedAccess: true`. Array index access
  returns `T | undefined`. Handle the undefined case explicitly.
- Prefer `readonly` on class fields that don't mutate after construction.
- No `any`. Use `unknown` and narrow when needed.

## Docker

- Multi-stage. Build stage installs full deps + tsc; runtime stage gets
  only `dist/`, pruned `node_modules`, and `package.json`.
- Runtime image runs as non-root user `plexmcp`. Don't add `USER root`.
- Token is passed at `docker run` time via `-e PLEX_TOKEN`. Never bake
  into the image, never `ENV PLEX_TOKEN=...` in the Dockerfile.

## Security

- Per global rules: never print secrets. The Plex token is a secret —
  redact it in any output that includes it.
- `.gitignore` excludes `*.pem`, `*.key`, `*.pfx`, `*.p12`, `.env`.
  When adding new secret-bearing file types, extend `.gitignore` and
  add a path exclusion to `.gitleaks.toml` if it's a generated artifact.
- Pre-commit hook runs gitleaks. Don't bypass with `--no-verify`.

## Git

- Local repo author is overridden to noreply (see `project_overview`).
  Don't `git config --unset` it — that re-exposes PII.
- `git add <specific-files>`, not `git add .` or `git add -A`.
- Commit messages: imperative mood, short first line, body explaining
  *why* over *what*. End with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
