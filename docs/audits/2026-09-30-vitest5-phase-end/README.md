# Plex MCP phase-end audit — 2026-09-30

Audit ID: `2026-09-30-vitest5-phase-end`

Tracked task: maintenance milestone close after PR #29; audit complete, findings awaiting owner decisions.

Audited base: [`eca65b3314a17402ff036a2b12ceb3798133640f`](https://github.com/CarlDog/plex-mcp/commit/eca65b3314a17402ff036a2b12ceb3798133640f)

Report disposition: review artifact; this report does not change runtime code, service configuration, release tags, or the authoritative status document.

## Conclusion and punch list

The Vitest 5 maintenance migration meets its scoped acceptance. All six serial suites use the supported explicit concurrency opt-out, the missing-credentials gate still works, no tests were removed, and local plus post-merge CI checks pass. This does not establish live Plex correctness or close the outstanding Tautulli and Apps SDK infrastructure phases.

Broader runtime/release confidence is **conditional**. One pre-existing **P1** tool-capability defect was confirmed with a process-local fetch stub and recorded in a **private draft security advisory**. Exploit payloads and destructive target details are deliberately absent here, following [SECURITY.md](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/SECURITY.md#L10-L15). The remaining findings concern dependencies, resource/configuration boundaries, live-test restoration, operator instructions, privacy-hook drift, and documentation/coverage debt. No audit fixes were applied.

Severity uses P1/high for a significant capability or safety boundary defect, P2/medium for actionable correctness, resource, dependency or operating-process issues, and P3/low for documentation, coverage or maintainability debt. An npm package advisory's upstream severity is distinct from demonstrated application exploitability.

| ID | Priority | Finding | Required decision |
| --- | --- | --- | --- |
| F01 | P1 | Tool capabilities are not confined to their intended authenticated endpoints | Authorize a separate security fix and regression tests |
| F02 | P2 | Three affected dependency packages; two remain in runtime dependencies | Review existing Dependabot remediation PRs |
| F03 | P2 | Startup parsing accepts malformed port/idle values; some invalid input produces raw stacks | Authorize strict boundary parsing and startup coverage |
| F04 | P2 | Binary response caps reject oversized data after full allocation in some cases | Authorize bounded streaming and cancellation coverage |
| F05 | P2 | Live round-trip failure cleanup can change state without a valid snapshot | Harden before any future authorized live suite |
| F06 | P2 | Quick-start instructions omit required host mounts | Correct operator examples in a documentation change |
| F07 | P2 | Auth and annotation guidance contradicts current safety contracts | Correct guidance while preserving current controls |
| F08 | P2 | Published privacy hook lags canonical name/case checks | Coordinate with the owner's existing local hook work |
| F09 | P3 | Test source is outside the TypeScript gate | Add a separate test-inclusive typecheck after correcting existing errors |
| F10 | P3 | Status and changelog lack a maintenance closure receipt and some shipped entries | Approve documentation-only updates |
| F11 | P3 | Runtime, distribution, planning, logging and subtitle documentation has stale claims | Correct the cited statements by category |
| F12 | P3 | Missing fixtures can silently pass live cases | Distinguish skipped fixtures from exercised endpoints |
| F13 | P3 | Large client/test modules and unused shared parsing exports need a focused future plan | Queue targeted extractions; avoid an audit rewrite |

## Scope, instructions and acceptance

[AGENTS.md](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/AGENTS.md#L7-L14) and [CLAUDE.md](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/CLAUDE.md#L7-L14) name **STATUS.md** as the single status authority. Neither contains a repository-specific phase-end checklist. The procedure used was the installed fleet-kit `phase-end-audit` skill, version 0.20.2, plus its `reference/rules/phase-end-audit.md`: every-phase documentation/configuration/deprived-env/test/refactor checks, supplemented here by quarterly dependency/privacy/hook review and the applicable pre-1.0 identity/license checks. The previous phase-end receipt is [STATUS.md:787–845](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/STATUS.md#L787-L845); standards audit #8 is recorded at [445–702](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/STATUS.md#L445-L702).

The repository describes its current phase as deployed operation, rather than a numbered maintenance phase ([STATUS.md:111–117](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/STATUS.md#L111-L117)). This audit closes the **Vitest maintenance milestone**. It does not invent or promote another phase:

- Tautulli code is implemented; Portainer configuration, redeployment and live acceptance remain pending ([STATUS.md:1143–1149](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/STATUS.md#L1143-L1149), [local integration plan](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/docs/TAUTULLI-INTEGRATION.md#L3-L16)).
- Apps SDK Phases 1–2 are implemented; a real identity provider, internet reachability and end-to-end ChatGPT verification remain pending in Phases 3–4 ([STATUS.md:1151–1160](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/STATUS.md#L1151-L1160), [phase plan](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/docs/CHATGPT-APPS-SDK.md#L200-L279)).
- Historical claims about deployed health, disabled bearer auth or live test success were not revalidated against production.

The referenced canonical Tautulli plan in the other repository returned 404 through the connected read-only fetch. Its contents could not be compared; this does not distinguish a missing path from unavailable access. The local plan and explicit pending-live gates were used. No other repository was edited.

The original owner checkout stayed on its existing branch with its unpushed commit and local state intact. A unique audit checkout and branch were created at the verified post-merge base. Setup used no checkout initially, an empty Git template, disabled hooks/fsmonitor, and disabled inherited filter commands before checkout. No owner credentials or service settings were copied. No branch cleanup was performed; recoverable migration and active audit work were retained.

## Merge and exact-commit CI evidence

[PR #29](https://github.com/CarlDog/plex-mcp/pull/29) was freshly checked at head `1125a1731b37438c96385337d4b3ece97c5c51c7`. It was clean/mergeable, had no submitted reviews, and all available checks succeeded apart from the intentional same-repo duplicate secret-scan skip. Repository rulesets were empty; the owner-authenticated branch protection read reported “Branch not protected.” Supported merge methods were merge, squash and rebase. The draft was marked ready and merged with a normal merge commit and an exact-head match; no administrator bypass or branch deletion was used.

Remote `main` was verified at `eca65b3314a17402ff036a2b12ceb3798133640f`. GitHub also marked PR #25 merged because its head commit is included through #29. No separate merge/close operation was issued for #25.

| Post-merge workflow at audited SHA | Result | Evidence |
| --- | --- | --- |
| Test: Ubuntu, Windows, macOS, lint + formatting | All jobs passed | [run 36667931990](https://github.com/CarlDog/plex-mcp/actions/runs/36667931990) |
| Docker: test gate and image build/publish | Passed | [run 36667932031](https://github.com/CarlDog/plex-mcp/actions/runs/36667932031) |
| CodeQL: JavaScript/TypeScript and Actions | Passed | [run 36667931497](https://github.com/CarlDog/plex-mcp/actions/runs/36667931497) |
| Push secret scan | Passed | [run 36667931946](https://github.com/CarlDog/plex-mcp/actions/runs/36667931946) |
| Automatic Copilot review workflow | Completed successfully | [run 36667936506](https://github.com/CarlDog/plex-mcp/actions/runs/36667936506) |

The existing main workflow published the container image as an automatic consequence of the authorized merge. No separate deployment operation was run and no production acceptance was inferred from image publication. The state of any automatic downstream deployment remains unverified.

## Validation receipt and limits

A fresh lockfile install used the existing local npm cache with `npm ci --offline --ignore-scripts --no-audit`. Package install scripts were not executed. Runtime used Node 26.8.1, npm 11.19.0 and Vitest 5.0.0, matching the declared runtime/npm floor and CI.

| Check at audited base | Observed result |
| --- | --- |
| `npm test`, Plex/Tautulli credentials cleared for the process | 19 files passed, 2 skipped; **138 passed, 64 skipped**, 202 collected |
| `npm run typecheck` | Passed for the currently configured source scope |
| `npm run build` | Passed |
| `npm run lint`, `npm run format:check` | Passed |
| `git diff --check` | Passed |
| Full reachable-history gitleaks scan, redacted, repository config | 176 commit diffs scanned, about 1 MB; no findings |
| PII scan of all 80 tracked files, generic paths/mail and configured host/name patterns | No matches; sensitive pattern values were not recorded |
| Author and committer identity audit, all 183 locally reachable commits | No personal email identities; account/bot `users.noreply.github.com` and GitHub-managed `noreply@github.com` recognized as privacy safe |
| License/package review | MIT recognized; package SPDX is MIT, copyright 2026 CarlDog; package remains private |
| `docker compose config --quiet` with dummy variables | Exit 0; sandbox Docker-client config-access warnings, no daemon/service operation |
| Missing-credentials built entrypoint | Exit 1, structured required-env error on stderr, empty stdout, no raw stack |
| Malformed configuration imports using dummy loopback URL/token | Port `0` and `3000junk`, and idle `-1`, accepted; invalid host authority rejected with raw stack |
| Framework-only failing-`beforeAll` probe | `afterAll` still ran; child test remained skipped |
| Endpoint confinement and oversized-body offline probes | Findings F01/F04 confirmed with process-local fetch stubs; no sockets or Plex calls |

The history scans include locally reachable historical references copied for inspection, including the owner's unpushed privacy-hook commit. The audited main ancestry has 180 commits. GitHub-managed and bot identities do not match every character restriction in the local human-commit hook; this is a privacy-safe generated-identity distinction, not evidence of leaked personal mail.

Static comparison preserved **62 Plex test titles**, **11 hook registrations**, and the six explicit serial opt-outs at [681](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/tests/plex.test.ts#L681), [836](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/tests/plex.test.ts#L836), [915](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/tests/plex.test.ts#L915), [970](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/tests/plex.test.ts#L970), [1070](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/tests/plex.test.ts#L1070) and [1144](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/tests/plex.test.ts#L1144). The outer [credential gate](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/tests/plex.test.ts#L31-L52) and [playlist order/cleanup](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/tests/plex.test.ts#L681-L764) are preserved. The prior remediation's dynamic collection also verified serial child metadata under global concurrency and skipping when either or both credentials are absent. No test was deleted to obtain a pass.

The skipped cases validate registration and collection, **not** live endpoint responses, state restoration, real IdP behavior, TLS certificate lifecycle, network redirects, load limits or production deployment. No statement here claims measured coverage percentages. No live Plex mutation, credential change, security-setting change or tag/release was performed.

## Findings and acceptance criteria

### F01 — P1: authenticated tool endpoint confinement

A pre-existing tool-capability defect was confirmed in released v0.8.0 and this main revision using a no-network stub. Transport Host/Origin/auth checks remain in place, but caller input can exceed a tool's intended endpoint/method capability. Actual destructive impact depends on live account permissions and server settings, which were not inspected.

Detailed source links, synthetic reproductions and fix acceptance tests are recorded in [private draft GHSA-qc63-2v4h-9f4w](https://github.com/CarlDog/plex-mcp/security/advisories/GHSA-qc63-2v4h-9f4w). The advisory is **draft**, unpublished, with no CVE request. This public report deliberately withholds exploit payloads and target details.

Decision: authorize a separate capability-confinement fix before claiming broad runtime/release readiness. It must reject unintended calls **before dispatch**, cover schema/handler and client boundaries, retain legitimate Plex use cases and existing confirmation/auth controls, and pass supported-OS CI. Live destructive tests are not needed to prove rejection.

### F02 — P2: current dependency advisories

`npm audit --json` on 2026-09-30 reports three affected packages: one high and two moderate. `npm audit --omit=dev --json` reports two moderate runtime packages. These are current advisory findings, not proof that every advisory is reachable through this application.

| Locked package | Dependency path / scope | Evidence and remediation review |
| --- | --- | --- |
| brace-expansion 5.0.9 | ESLint → minimatch; development only | [lock entry](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/package-lock.json#L1774-L1782); [high recursion advisory](https://github.com/advisories/GHSA-qhr7-859c-m2p7), [additional high advisory](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p), [moderate advisory](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr); [PR #31](https://github.com/CarlDog/plex-mcp/pull/31) targets 5.0.12 |
| fast-uri 3.1.7 | MCP SDK → ajv; runtime | [lock entry](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/package-lock.json#L2412-L2419); [advisory](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj); [PR #32](https://github.com/CarlDog/plex-mcp/pull/32) targets 3.1.8 |
| ip-address 10.4.0 | MCP SDK → express-rate-limit; runtime | [lock entry](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/package-lock.json#L2717-L2724); [classification advisory](https://github.com/advisories/GHSA-rpw4-54j3-4h4q), [NAT64 advisory](https://github.com/advisories/GHSA-2vr4-cq9g-pvrc), [family comparison advisory](https://github.com/advisories/GHSA-j6r3-76f7-8jcv), [unbounded diagnostic advisory](https://github.com/advisories/GHSA-h3mg-xc3c-68pw); [PR #30](https://github.com/CarlDog/plex-mcp/pull/30) targets 10.7.2 |

The September 1 project-memory dependency audit is a historical zero-advisory receipt, not a current clean bill. No audit fix, force upgrade, dependency merge, or lockfile mutation was applied here. The newly generated Dependabot PRs were observed only. PR #28 remains a separate runtime dependency update.

Decision: review #30–32 using their exact-head checks and current advisory results; keep the dev/runtime distinction and validate the complete lockfile. Do not infer absence of application risk merely from development scope or absence of a direct callsite.

### F03 — P2: startup parsing and deprived configuration

[config.ts:50–54](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/src/config.ts#L50-L54) uses permissive `parseInt` for the port; [111–112](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/src/config.ts#L111-L112) similarly reads idle timeout. Dummy configuration imports accepted port zero, a numeric prefix with junk suffix, and negative idle duration. [index.ts:56](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/src/index.ts#L56) selects transport by truthiness, so port zero silently selects stdio. Invalid idle values feed the [session sweep](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/src/mcp-route.ts#L259-L282).

A strict port helper already exists and its tests reject these cases ([shared parser](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/src/shared/mcp-environment.ts#L47-L51), [tests](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/tests/mcp-environment.test.ts#L41-L49)), but production does not use it. Invalid host-authority input was rejected with a raw stack, while absent Plex credentials correctly produced a clean structured exit.

Decision: adopt strict existing parsers at the production boundary, route validation errors through clean startup failure, and add child-process tests for missing/malformed configuration. Preserve intentional TLS laziness and fail-soft optional Tautulli behavior.

### F04 — P2: binary size caps after allocation

[plex.ts:1551–1562](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/src/plex.ts#L1551-L1562) fully materializes response data when the header is absent/unreliable, then compares its length to the cap. An offline oversized-body stub confirmed that the full-body read occurs before rejection. The cap therefore limits accepted output, but not peak allocation or transferred bytes in that case.

Decision: authorize bounded decoded-byte streaming and cancellation at the limit, with absent, inaccurate and compressed-content length cases. Retain timeout/retry and response privacy behavior. No production load behavior was measured.

### F05 — P2: live mutation restoration on failed setup/body

The [rating snapshot hook](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/tests/plex.test.ts#L1073-L1086) may fail before capturing a rating, while its cleanup still calls `rateItem` with an undefined original value; [the client interprets that value as clearing a rating](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/src/plex.ts#L887-L894). An isolated framework probe confirmed Vitest 5 runs `afterAll` after a failed `beforeAll`. This is a genuine failure-path risk, unchanged by migration.

The [watched round trip](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/tests/plex.test.ts#L1156-L1167) lacks failure-safe restoration after changing watched state. Existing comments already acknowledge that this round trip changes the watch timestamp.

Decision: guard cleanup on a successfully captured snapshot and restore the intended prior state on body failure before any future authorized live run. Use offline failing-setup/body probes first. Actual live restoration and timestamp behavior remain untested here.

### F06 — P2: incomplete fresh-operator instructions

The [Compose quick start](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/README.md#L244-L250) omits required host directories, and the [Portainer required-env list](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/README.md#L267-L269) omits the log-source directory. Compose requires all three mounts: [image](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/docker-compose.yml#L107), [saved logs](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/docker-compose.yml#L115) and [read-only primary log source](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/docker-compose.yml#L118).

Decision: correct the examples and required-variable list, including container write permissions and the read-only source. Keep the fail-fast Compose substitutions.

### F07 — P2: safety-related guidance drift

[AGENTS.md:109–115](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/AGENTS.md#L109-L115) says there is no HTTP bearer support, contradicting [current CLAUDE guidance](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/CLAUDE.md#L127-L140), [README](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/README.md#L182-L204), [config](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/src/config.ts#L100) and [route enforcement](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/src/mcp-route.ts#L139-L158).

The [Apps SDK annotation table](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/docs/CHATGPT-APPS-SDK.md#L140) groups destructive matching/split/merge operations under non-destructive hints, while [runtime constants](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/src/tools/helpers.ts#L155-L176) correctly mark them destructive. This is document drift; existing intended-operation runtime safeguards remain present. The separate F01 capability issue is tracked privately.

Decision: synchronize guidance with implemented controls and preserve required confirmation. This does not authorize enabling auth or changing client/service settings.

### F08 — P2: canonical privacy-hook drift

The published [.githooks/pre-commit](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/.githooks/pre-commit#L99-L149) lacks the canonical configured-personal-name checks and uses case-sensitive content matching at [129](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/.githooks/pre-commit#L129). The installed fleet-kit 0.20.2 canonical hook has both improvements. Its optional plugin-integrity section is specific to fleet-kit and is not a missing Plex requirement.

Current tracked-file PII and identity scans are clean. The owner's original checkout already contains unpushed work addressing the name/case guard; it was preserved and not copied into this report branch.

Decision: review and publish that existing work separately, ensuring out-of-band sensitive pattern values never enter tracked files. Do not reimplement or overwrite the owner's change.

### F09 — P3: test-inclusive typecheck remains missing

[tsconfig.json:16–17](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/tsconfig.json#L16-L17) excludes test source from the TypeScript gate. [STATUS.md:1396–1407](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/STATUS.md#L1396-L1407) already records this gap and pre-existing undefined-access errors. This explains why source types/build passed while the removed Vitest API failed collection.

Decision: correct test typing and add a separate no-emit test configuration, preserving the production emit boundary. Continue no-credentials runtime collection as a dependency-major migration guard.

### F10 — P3: closure/release receipts are stale

[STATUS.md:3–10](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/STATUS.md#L3-L10) lacks the Vitest maintenance closure. [Unreleased changelog](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/CHANGELOG.md#L12-L110) omits the migration, diagnostic filesystem fallback and subtitle accessibility normalization, although the latter features are visible in [README](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/README.md#L337-L339) and [subtitle.ts](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/src/subtitle.ts#L3-L21).

Package, lockfile and server version remain 0.8.0 and the version-sync test passes. There are 35 commits since v0.8.0 at the audited base. This is a release-cadence decision, not permission to tag.

Decision: add a dated maintenance receipt and missing Unreleased entries in separate documentation commits. Keep the Tautulli/Apps SDK live gates pending and select a release version/cadence separately.

### F11 — P3: other documentation currency

- [AGENTS](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/AGENTS.md#L19) and [CLAUDE](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/CLAUDE.md#L19) say Node 22+, but [package.json](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/package.json#L44-L47) declares Node >=26 and npm 11.19.0; CI pins npm 11.19.0, while Docker selects Node 26 without an explicit npm pin.
- [README distribution](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/README.md#L240-L241) claims amd64+arm64 and every-main publication; [workflow](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/.github/workflows/docker-publish.yml#L7-L21) ignores specified documentation paths and [builds only amd64](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/.github/workflows/docker-publish.yml#L110-L115).
- [Apps SDK introduction](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/docs/CHATGPT-APPS-SDK.md#L5) and agent layout descriptions say “not started” despite completed Phases 1–2; the [configuration table](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/docs/CHATGPT-APPS-SDK.md#L120) includes an explicitly unimplemented health-auth toggle.
- [Compose comments](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/docker-compose.yml#L27-L28) claim host:port entries are accepted, while production parsing rejects them.
- [INFO logging example](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/README.md#L397) prints argument values; [helpers](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/src/tools/helpers.ts#L186-L211) log keys at INFO and values at DEBUG.
- [Plex API subtitle guidance](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/docs/PLEX-API.md#L510-L511) calls hearing-impaired a native confirmed field; [normalization](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/src/subtitle.ts#L3-L21) derives it from SDH/title markers when no native boolean exists.

Decision: correct these statements without adding unimplemented configuration or implying new live verification.

### F12 — P3: fixture absence is reported as success

Some live tests return successfully without exercising an endpoint when fixtures are unavailable: [external IDs](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/tests/plex.test.ts#L543-L548), [posters](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/tests/plex.test.ts#L1003-L1007) and [watched state](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/tests/plex.test.ts#L1147-L1152) are examples.

Decision: use supported explicit skip behavior with reasons so future live receipts distinguish exercised calls from missing fixtures. The current audit's 64 skipped cases are the top-level credential gates, not evidence that those internal conditions were exercised.

### F13 — P3: refactor/streamline queue

[plex.ts](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/src/plex.ts#L1) is 1,609 lines and [the integration file](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/tests/plex.test.ts#L1) is 1,176 lines. The client combines transport, metadata projection, filesystem output, logs, posters and mutations. The integration suite is cohesive as a discovered live fixture harness, but its cleanup should be isolated carefully when touched.

Field projection has two similar loops ([582–586](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/src/plex.ts#L582-L586), [754–762](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/src/plex.ts#L754-L762)); this alone does not meet the three-site extraction threshold. Shared `parseLogLevel` and `DEFAULT_SESSION_IDLE_MS` are unused by production while equivalent parsing is implemented elsewhere. [CaptureServer](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/tests/_test_utils.ts#L1-L39) already consolidates registration helpers. Tautulli output types are narrowed; settled Plex metadata/playlist shapes remain candidates for incremental typing.

Decision: queue focused transport/filesystem or domain-client extractions with future work and tests. No rewrite or new abstraction was justified by a development-only test-runner migration. No declared hexagonal architecture or project-specific adoption trigger was found; new major runtime features should record their architecture decision and dependency direction.

## Protections checked and additional decisions

Static source review and existing offline tests cover strict Host validation and default Origin rejection, constant-time bearer comparison before dispatch, OAuth issuer/audience/signature/time/scope checks with same-origin JWKS restrictions, session lifecycle/rate limits, transport errors/retries, Tautulli fail-soft configuration and privacy allowlists, filesystem basename/non-symlink log-source controls, authentication-error exclusion from diagnostic fallback, and intended destructive title confirmation. The image URL tests cover off-origin forms but do not prove endpoint confinement; F01 records that gap.

Docker uses a non-root runtime user, prunes development dependencies, requires host mounts, keeps the primary-log mount read-only and bounds container logs. Local TLS/real IdP lifecycle and network/load behavior remain unverified.

Both optional auth mechanisms are enforced against the same Authorization bearer value when configured together ([route](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/src/mcp-route.ts#L153-L187), [JWT middleware](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/src/auth.ts#L179-L191), [composition](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/src/index.ts#L98-L99)). A normal issuer JWT will not equal an unrelated static secret. Decide whether to document/reject conflicting modes or define supported coexistence, then add a composition test. This audit does not treat the current AND requirement as a transport-auth bypass.

The tool inventory is complete: **44 registered and 44 documented names**, no differences; [tool-naming tests](https://github.com/CarlDog/plex-mcp/blob/eca65b3314a17402ff036a2b12ceb3798133640f/tests/tool-naming.test.ts#L17-L45) enforce uniqueness/naming. Private npm packaging is deliberate, MIT metadata matches, and no runtime dependency was added by the Vitest migration.

Configuration/schema drift was checked by comparing production environment parsing, Compose substitutions, README/agent configuration guidance, and the Apps SDK plan, plus the existing environment/auth/tool tests. No dedicated schema-drift suite was found. This category is **not clean**: F03, F06, F07 and F11 record the discrepancies; the existing tests do not establish documentation/production schema parity.

The read-only [GitHub community-profile endpoint](https://api.github.com/repos/CarlDog/plex-mcp/community/profile) returned **57%** on 2026-09-30: recognized MIT license and README, but no contributing guide, code of conduct, issue template or PR template. Its documentation URL points at `tree/master/docs`, while the default branch is `main`. The pre-1.0 community-standards green check therefore **did not pass**. Decide whether to supply the relevant contribution files and correct that metadata, or explicitly accept the remaining community-profile gaps for this solo-maintained project; this audit adds no speculative templates.

Memory was read as historical context, including the September 1 dependency receipt and local Codex notes; no unrelated memory/project writes were made. The durable closeout is this reviewable report. Recommended lesson: development-major upgrades require runtime collection of credential-gated tests; source typechecking and a green skipped integration count are separate assurances.

## Remaining decisions

1. Prioritize and separately authorize F01's capability-confinement fix; keep the draft advisory private until a disclosure decision.
2. Review Dependabot #30–32 and any separately chosen runtime updates using exact-head CI and current advisory data.
3. Approve configuration, binary-limit and live-cleanup fixes as distinct scoped changes; retain offline rejection/failure-path coverage.
4. Coordinate the existing privacy-hook work; approve documentation updates by category and the test-inclusive typecheck gate.
5. Decide release/tag timing after those risks are addressed. Authorize live Tautulli rollout, real IdP infrastructure, production acceptance or Plex mutations separately if desired.

This audit report PR remains **draft** for review. Publishing this report does not authorize merging it or any remediation PR.
