# Suggested commands

Originally developed on Windows with bash (Git Bash) and PowerShell;
the commands below assume one of those shells. Forward slashes in
paths work in bash; backslashes in PowerShell.

## Node / build

```bash
npm install            # install deps
npm run typecheck      # tsc --noEmit (fast feedback)
npm run build          # tsc → dist/
npm run dev            # tsx src/index.ts (needs PLEX_URL, PLEX_TOKEN)
npm run start          # node dist/index.js
```

## Docker

```bash
docker build -t plex-mcp .
docker run -i --rm \
  -e PLEX_URL=http://192.168.1.x:32400 \
  -e PLEX_TOKEN=<token> \
  plex-mcp
```

## Git / GitHub

```bash
git status
git add <specific-files>      # don't use `git add .` per security rules
git commit -m "..."            # pre-commit hook runs gitleaks
git push
gh repo view --web             # open repo in browser
gh pr create                    # open PR (when on a branch)
```

The pre-commit hook is enabled via `git config core.hooksPath .githooks`
(already done in this repo). Requires `gitleaks` on PATH — install via
`winget install gitleaks` on Windows, `brew install gitleaks` on macOS,
or your distro's package manager on Linux.

## Secret scan (manual)

```bash
gitleaks detect --no-git --redact --config .gitleaks.toml --source .
```

## Windows-specific notes (when applicable)

- On Windows, `bash` is Git Bash (Unix-like). Drive letters map as
  `/c/path` ↔ `C:\path`.
- Avoid `find`, `grep`, `cat`, `ls -R` for file ops — use the Glob/Grep/Read tools.
- Line endings: with autocrlf, working tree is CRLF on Windows and the
  repo stays LF. Shell scripts checked into the repo (e.g.
  `.githooks/pre-commit`) must keep LF endings to run on Linux/Docker.
