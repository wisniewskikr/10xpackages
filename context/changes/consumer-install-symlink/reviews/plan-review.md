<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Consumer install (symlink mode) — S-01

- **Plan**: context/changes/consumer-install-symlink/plan.md
- **Mode**: Deep (riskiest claims verified against files read in-session; no sub-agent — single-file blast radius, all evidence already in hand)
- **Date**: 2026-08-29
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 1 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING → PASS after fixes |
| Plan Completeness | FAIL → PASS after fixes |

## Grounding

Paths: 8/8 ✓ (`src/install.ts`, `src/manifest.ts`, `test/entrypoints.test.ts`, `package.json`, `package-lock.json`, `README.md`, both `.claude/config-templates/m5l4-github-packages-*` templates exist; `test/install.test.ts` correctly absent — new file).
Symbols: 5/5 ✓ (`findConsumerRoot` + `process.env.PROJECT_ROOT` guard at `src/install.ts:12-13`; `runInstall` at `:32`; `applyRulesBlock` at template `:52`; `SENTINEL_BEGIN/END` + `interface ToolkitManifest` with `tool`/`installedAt`/`files` at `src/manifest.ts:25-47`).
brief↔plan: 3 phases, decision table, scope — consistent ✓.

Internal consistency: promise-gap scan clean (every Desired End State capability has a backing phase); contradiction scan clean ("What We're NOT Doing" items do not reappear in phases). Progress↔Phase: after F1 fix, Phase blocks carry plain bullets only; Progress 1.1–1.7 / 2.1–2.4 / 3.1–3.7 map 1:1 to the Success Criteria bullets.

## Findings

### F1 — Phase Success Criteria used `- [ ]` checkboxes instead of plain bullets

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 / 2 / 3 — `#### Automated Verification:` / `#### Manual Verification:`
- **Detail**: The progress-format contract requires Phase blocks to contain plain `- ` bullets, with `- [ ]` / `- [x]` appearing only in the single `## Progress` section. All three phases wrote their Success Criteria as `- [ ]` items, duplicating the checkbox state `/10x-implement` parses from `## Progress` and risking double-counting / parser confusion.
- **Fix**: Convert every `- [ ]` under the Phase blocks' Verification headings to `- `; leave `## Progress` (lines 507+) untouched.
- **Decision**: FIXED — all Phase-block bullets converted; `grep '^- \[ \]'` now returns only lines ≥515, all inside `## Progress`.

### F2 — Consumer commit/gitignore policy for the `.claude/skills/*` symlinks left unspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §3 (README) / Desired End State
- **Detail**: The plan routes the OQ-6 manifest commit/ignore recommendation into the README but says nothing about the skill symlinks themselves. In roaming mode those links point into git-ignored `node_modules`; committing them is fragile — on Windows without `core.symlinks` a committed symlink becomes a plain text file holding the target path, which Claude Code would then read as a "skill".
- **Fix**: Extend the Phase 3 README contract to recommend the consumer gitignore the managed skill entries under `.claude/skills/` (regenerated per-install in roaming mode), while keeping the `CLAUDE.md` block and the `.npmrc` line as normally-committed real content.
- **Decision**: FIXED — Phase 3 §3 contract now carries the gitignore-the-managed-skill-links recommendation with the Windows `core.symlinks` rationale.

### F3 — `vitest` v2→v4 double-major bump bundled into the Phase 1 feature commit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Implementation Approach / Phase 1 §3
- **Detail**: `npm audit fix --force` pulls a two-major `vitest` jump that can change the config API (`vitest/config` import, `test.include`), so a harness breakage would be entangled with the core `src/install.ts` rewrite in the same phase/commit. (The F-01 impl-review sanctioned doing the bump "when S-01 touches the harness" but did not address commit hygiene.)
- **Fix**: Land the bump as its own commit at the **start** of Phase 1, before the `src/install.ts` rewrite, so a regression is bisectable; verify the v4 config API and that the existing suite still passes.
- **Decision**: FIXED — Implementation Approach and Phase 1 §3 both now specify a separate first-in-phase commit for the bump with a v4 config-API check.

### F4 — Collision detection keyed on `EINVAL` specifically

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details — "Symlink type & target"
- **Detail**: `fs.readlinkSync` on a non-link can throw `EINVAL`, `UNKNOWN`, or `EPERM` depending on OS / Windows version. Matching only `EINVAL` would misclassify a real directory on some Windows setups. A broken managed link (target missing) also makes `fs.realpathSync` throw, which the plan didn't handle.
- **Fix**: Treat any `readlinkSync` throw as "not our managed link" and branch on `fs.existsSync` (collision vs. create); wrap `realpathSync` in its own try/catch and recreate on throw-or-mismatch.
- **Decision**: FIXED — the "Symlink type & target" bullet now specifies any-throw handling plus broken-link recreation.

### F5 — `runInstall` null-root no-op guard not explicit in the Phase 1 contract

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1 — Contract
- **Detail**: Key Discoveries and Migration Notes state a `null` consumer root stays a quiet no-op, but Phase 1's `src/install.ts` contract didn't restate that the rewritten `runInstall()` must early-return on `findConsumerRoot() === null` before any reconcile step — the exact behavior an implementer could drop while restructuring the function.
- **Fix**: Add an "Early return on null root" line to the Phase 1 §1 contract.
- **Decision**: FIXED — contract bullet added.

## Notes

Solid plan: tight scope discipline (S-02..S-06 boundaries all explicit and consistent), reuses the existing `findConsumerRoot` and `test/entrypoints.test.ts` patterns, and folds the highest-risk items (manifest-byte idempotency vs. `installedAt` churn, cross-platform symlink type, `.npmrc` non-destructive ensure-line, no-secret guarantee) into "Critical Implementation Details" rather than leaving them for the implementer to discover. All five findings were low-impact and fixed in place; no architectural rework required.
