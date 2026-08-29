<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Consumer install (symlink mode) — S-01

- **Plan**: context/changes/consumer-install-symlink/plan.md
- **Scope**: Full plan — Phases 1–3 of 3
- **Date**: 2026-08-29
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Scope check

Commits reviewed: `da2283e` (p1 pre — vitest bump), `234a17a` (p1), `d499570` (p2),
`3b1d158` (p3), `1bbe52f` (epilogue).

| Planned change | Status |
|---|---|
| `src/install.ts` — `linkSkills` (junction/symlink, any-throw collision handling, resolve-or-recreate) | MATCH |
| `src/install.ts` — `writeManifest` (equality-check skip ignoring `installedAt`) | MATCH |
| `src/install.ts` — `runInstall` early-return on `findConsumerRoot() === null` | MATCH |
| `src/install.ts` — `applyRulesBlock` (create / splice / append + malformed warn-skip) | MATCH |
| `src/install.ts` — `ensureNpmrc` (ensure-line, conditional `${NODE_AUTH_TOKEN}` ref, no secret) | MATCH |
| `test/install.test.ts` — 12 cases across the three phases | MATCH |
| `package.json` / `package-lock.json` — `vitest` 2→4 (own commit, first in p1) | MATCH |
| `README.md` — real S-01 flow + OQ-6 (commit manifest) + gitignore-skill-links note | MATCH |
| `context/foundation/roadmap.md` — S-01 → in-progress | MATCH (process artifact) |

No files changed outside the plan. "What We're NOT Doing" all held: `src/uninstall.ts`
untouched (S-03); no update/reconcile-diff (S-02); no copy/`npx` mode (S-04); the
malformed-sentinel handling is a minimal warn+skip with in-code comments deferring the
rich abort (FR-012) and injection guard (FR-014) to S-05; `ToolkitManifest` and the
sentinel constants unchanged.

## Success criteria — re-verified fresh

| Check | Command | Result |
|---|---|---|
| Build | `npm run build` | PASS — `dist/{cli,install,uninstall}.js` |
| Type check (src + test) | `npm run typecheck` | PASS — clean |
| Test suite | `npm test` (runs `pretest` build) | PASS — 4 files, 27 tests |
| npm audit | `npm audit` | 1 low-severity residual (esbuild dev-server file-read on Windows) — dev-only, never runs under `vitest run` / `tsup`, not published; dispositioned by plan criterion 1.4 |
| Tarball contents | `npm pack --dry-run` | PASS — `dist/`, `skills/`, `rules/`, `bin/`, `README.md`, `package.json` only |
| Skill-link idempotency | re-run `ai-toolkit install`, `stat` the junction | PASS — same inode + mtime; not recreated |
| Rules-block idempotency | two-run install in a scratch repo | PASS — exactly one BEGIN/END, hand-written sections intact, second-run `git diff` empty |
| `.npmrc` no-secret | e2e with `NODE_AUTH_TOKEN=s3cr3t…` | PASS — `.npmrc` holds the literal `${NODE_AUTH_TOKEN}` reference, not the value; unrelated `@other:` entry preserved |
| Manifest idempotency (NFR) | commit + re-run | PASS — manifest byte-identical, `installedAt` preserved |

Manual items 1.6/1.7, 2.4, 3.5/3.6/3.7 were executed live in-session (scratch repos
`/cons-p1`..`/cons-p3`, `/cons-rev`) under the `/goal` human-out-of-loop directive:
Windows junctions created without elevation, out-of-band `CLAUDE.md` content preserved,
`.npmrc` conditional credential correct, README consumer-setup section coherent with an
unambiguous OQ-6 recommendation.

## Findings

### F1 — CRLF consumer repos could see a `CLAUDE.md` / `.npmrc` diff on every install

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/install.ts:158-163 (`applyRulesBlock`), src/install.ts:191-205 (`ensureNpmrc`)
- **Detail**: Both helpers compare against, and write, LF-only content. In a consumer repo whose editor or `.gitattributes` normalizes to CRLF, the `next !== existing` check (and the `.npmrc` trimmed-line compare) would mismatch on line-ending alone, rewriting the file to LF on every install — a diff on each run, which nicks the idempotency guardrail for those repos. Not caught because the plan and tests assume LF. All in-session verification was on LF scratch repos.
- **Fix**: Normalize `\r\n` → `\n` on the existing content before the equality compare (and compare `.npmrc` lines with `\r` stripped); optionally preserve the detected EOL on write. Deferrable — most repos are LF.
- **Decision**: SKIPPED — recorded as a follow-up; no code change this review (LOW impact, out of the plan's stated scope; a natural candidate for S-02 when update-idempotency gets hardened).

### F2 — `ensureNpmrc` empty-file guard is hard to read

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/install.ts:186-189
- **Detail**: `.filter((line, _i, all) => !(all.length === 1 && line === ""))` correctly drops the single empty element `"".split("\n")` produces, but the intent isn't obvious at a glance. A guard clause reads clearer: `const lines = original.trim() === "" ? [] : original.replace(/\n+$/, "").split("\n");`.
- **Fix**: Replace the `.filter(...)` with the ternary guard above. Behaviour is identical (covered by the "creates .npmrc when none exists" test).
- **Decision**: SKIPPED — cosmetic; safe to fold into a later touch of this file.

## Notes

Clean, disciplined implementation. Each phase is a single reconcile step wired into
`runInstall` in order, committed separately with the plan's `## Progress` SHAs written
back. Code matches the package's own `code-review` skill conventions (verb-first
camelCase functions, `UPPER_SNAKE_CASE` module constants, `interface` for object
shapes, try/catch with `${PACKAGE_NAME}:`-prefixed messages) and mirrors the existing
`test/entrypoints.test.ts` harness structure (tmpdir consumer root via `PROJECT_ROOT`,
`console` mocked, env restored in `afterEach`). The three highest-risk items from the
plan's "Critical Implementation Details" — manifest-byte idempotency vs. `installedAt`
churn, cross-platform link type, non-destructive `.npmrc` ensure-line with no persisted
secret — are all implemented as specified and verified end-to-end on Windows. Both
findings are LOW-impact observations with no bearing on the shipped behaviour.
