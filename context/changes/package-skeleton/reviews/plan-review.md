<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Package Skeleton (F-01)

- **Plan**: context/changes/package-skeleton/plan.md
- **Mode**: Deep (no code-verification sub-agent — greenfield, zero existing code / blast radius)
- **Date**: 2026-08-28
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

Paths: all greenfield (no `package.json`/`src`/`bin`/`skills`/`rules` present) — matches the plan's Current State Analysis ✓.
Symbols/refs: 5/5 `.claude/config-templates/m5l4-github-packages-*.template` cited by the plan exist ✓.
brief↔plan: phases, decisions, scope consistent ✓.

## Findings

### F1 — `.gitignore` strips `dist/` from the published tarball

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §10 (repo hygiene files); Desired End State
- **Detail**: `package.json#files` lists `dist/` and Desired End State requires the tarball to contain `dist/`, but Phase 1 also git-ignores `dist/`. npm's packing rule: with a `files` allowlist and **no** `.npmignore`, npm falls back to `.gitignore` for exclusions — so `dist/**` would be dropped from `npm publish` output, shipping an empty package and breaking S-06.
- **Fix ⭐ (applied)**: Add a committed `.npmignore` listing dev-only paths (`src/`, `test/`, `*.config.ts`, `tsconfig.json`, `context/`, `.claude/`, `.github/`). Its presence stops the `.gitignore` fallback; the `files` allowlist stays the primary control. Also add `pretest: npm run build` and a Phase 2 assertion that `npm pack --dry-run` lists `dist/cli.js`.
  - Strength: One file; standard npm idiom; adds a regression test for the exact failure.
  - Tradeoff: A second ignore file to keep roughly in sync with `files`.
  - Confidence: HIGH — well-documented npm behaviour.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix applied to plan)

### F2 — `moduleResolution: "NodeNext"` breaks the typecheck step

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §2 (`tsconfig.json`)
- **Detail**: With `module`/`moduleResolution: "NodeNext"`, `tsc` requires explicit `.js` extensions on relative import specifiers. `src/cli.ts` imports `./install`, `./uninstall`, `./manifest` — extensionless — so step 1.3 (`npm run typecheck`) would fail out of the box, and the plan gives the implementer no guidance to add extensions.
- **Fix ⭐ (applied)**: Set `moduleResolution: "Bundler"`, `module: "ESNext"` — tsup/esbuild owns emit, so bundler-style resolution (no extension requirement) is the correct model and matches how the entrypoints are actually built.
  - Strength: Removes the failure class entirely; idiomatic for a tsup project.
  - Tradeoff: Source is no longer directly `node`-runnable without the build (already true — entry is via `dist/`).
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix applied to plan)

### F3 — Progress step 1.2 title diverges from the Phase 1 criteria bullet

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: `## Progress` → Phase 1 → 1.2
- **Detail**: Phase 1 Success Criteria bullet reads ``npm run build && node -e "…accessSync('dist/cli.js')"``; Progress 1.2 paraphrased it as "`npm run build` then `dist/cli.js` exists". `references/progress-format.md` wants matching titles so `/10x-implement` maps them cleanly.
- **Fix (applied)**: Reworded Progress 1.2 to match the criteria bullet verbatim.
- **Decision**: FIXED (Fix applied to plan)

### F4 — `bin/ai-toolkit.js` shim alongside `src/cli.ts`

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 1 §8–9
- **Detail**: The plan keeps a committed 2-line shim whose only job is `require("../dist/cli.js")`. Pointing `package.json#bin` straight at `dist/cli.js` (tsup adds the shebang) would drop one file. The plan's rationale — a build-layout-independent `bin` target and a stable `postinstall` entry — is legitimate, and tech-stack.md lists `bin/` as a layout dir.
- **Fix**: None required. Kept as designed; noted as a deliberate, reversible choice.
- **Decision**: ACCEPTED (design choice, documented in plan)

### F5 — `postinstall` wired to a no-op stub is shippable but premature to publish

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 (`package.json` scripts)
- **Detail**: `postinstall` invokes the installer stub. That is correct for the skeleton (it no-ops when not a nested dep), but if S-06 publishes `0.1.0` before S-01 lands, consumers get a package whose `postinstall` only prints a notice. This is a sequencing note for S-06, not a plan defect.
- **Fix**: None. Flagged so S-06 gates publish on S-01 (or ships an explicit pre-release tag).
- **Decision**: ACCEPTED (sequencing note carried to S-06)

## Triage Summary

- Fixed:     F1, F2, F3   (3)
- Accepted:  F4, F5       (2)
- Skipped:   —
- Dismissed: —

► Verdict after fixes: REVISE → **SOUND**
