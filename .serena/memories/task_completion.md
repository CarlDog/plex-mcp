# Task completion checklist

Before marking a code-touching task done:

1. **Typecheck:** `npm run typecheck` (must be clean)
2. **Build:** `npm run build` (must succeed; verifies dist output)
3. **Tests:** none yet — when added, run them here
4. **Lint:** none configured yet — skip
5. **Manual verification (when relevant):**
   - For tool changes: run `npm run dev` against a real Plex server
     and call the tool via an MCP client (Claude Desktop or `mcp inspector`).
   - For Dockerfile changes: `docker build -t plex-mcp .` and confirm
     `docker run -i --rm -e PLEX_URL=... -e PLEX_TOKEN=... plex-mcp`
     produces a clean stdio handshake.
6. **STATUS.md:** update in the same commit as the work if the change
   advances or alters project state. Don't batch status updates.
7. **Commit:** the pre-commit hook runs gitleaks automatically. If it
   fails, fix the underlying issue — never bypass with `--no-verify`.

## Don't

- Don't run `npm install` to "fix" build issues without understanding
  what changed.
- Don't add tests *for the impossible* — test real behavior, not
  hypotheticals that can't happen given system constraints.
- Don't introduce mocks for the Plex API in tests. Use a real Plex
  server behind an env-gated test (per global working-style on
  mock/prod divergence).
- Don't lower the test bar to make code pass. Fix the code, not the test.
- Don't commit with the global git identity — verify
  `git config user.email` shows the noreply address before committing.
