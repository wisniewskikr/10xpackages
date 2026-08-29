# Consumer clean uninstall (S-03) — Plan Brief

> Full plan: `context/changes/consumer-uninstall-clean/plan.md`

## What & Why

`src/uninstall.ts` is still a stub. This change makes `ai-toolkit uninstall` a
real, manifest-driven operation: a consumer removes the package and is left with
a **clean repo — zero package artifacts** (verifiable via version control), per
PRD FR-011 and the US-02 acceptance criterion "Deinstalacja usuwa dokładnie
pliki z manifestu".

## Starting Point

S-01 shipped the forward reconcile (skill links, sentinel-fenced `CLAUDE.md`
block, `.npmrc` registry/credential line, five-field `ToolkitManifest`). S-02
added the withdrawn-artifact prune and CRLF-agnostic block/line editing.
`runUninstall()` logs "not implemented"; `cli.ts` still calls both commands
stubs. The `node_modules`-walk + EOL helpers uninstall needs live private inside
`install.ts`.

## Desired End State

`runUninstall()` reads `.claude/.ai-toolkit-manifest.json` and reverses exactly
what it records: owned skill links removed, the team-rules block stripped from
`CLAUDE.md` (surrounding text byte-identical), the two known `.npmrc` lines
removed (unrelated lines untouched), any file left empty deleted, emptied
`.claude/skills/` and `.claude/` removed, and the manifest deleted last. A
second run is a clean no-op; CRLF repos see only intended removals.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Shared `findConsumerRoot` / EOL helpers | Extract to new `src/consumer.ts`, `install.ts` re-imports | One owner for the `node_modules` walk and CRLF logic; pure refactor, install tests untouched | Plan |
| Malformed / unreadable manifest | Warn, leave every file in place | Rich candidate-listing (FR-013) is explicitly S-05 / nice-to-have; never delete from unreadable state | Plan |
| Malformed `CLAUDE.md` block (one marker) | Warn, skip the file, continue | Mirrors `applyRulesBlock`'s posture; hard abort is S-05 | Plan |
| `.npmrc` removal | Drop lines exactly equal to the registry line and the `${NODE_AUTH_TOKEN}` line; keep all others; delete file if emptied | Symmetric inverse of `ensureNpmrc`; unrelated entries are sacrosanct | Plan |
| Emptied files / dirs | Delete `CLAUDE.md` / `.npmrc` if only package content was there; guarded shallow `rmdir` of `.claude/skills/` then `.claude/` | "kontrola wersji po deinstalacji nie pokazuje pozostałości" — zero trace | Plan |
| OQ-7 `preuninstall` hook | No hook | npm does not run a dependency's lifecycle scripts on removal; PRD makes uninstall a deliberate explicit command | Plan |
| Manifest deletion order | Last, after all file removals | A mid-run crash stays resumable from an accurate `files[]` | Plan |
| CLI `USAGE` text | Drop the "stub" tags now that install + uninstall are real | Keep help output honest | Plan |

## Scope

**In scope:**
- `src/consumer.ts` (extracted helpers); `install.ts` re-imports
- Real `runUninstall()`: skill links, `CLAUDE.md` block, `.npmrc` lines,
  empty-file/dir cleanup, manifest deletion
- CRLF-agnostic block removal; malformed-state postures (warn + leave)
- `cli.ts` usage text; `test/uninstall.test.ts`
- README `### Consumer uninstall` + status/layout/context refresh; roadmap S-03

**Out of scope:**
- Rich corrupted-manifest UX / file:line pointers / `--force` (FR-013, S-05)
- Sentinel-injection guard, hard abort (FR-012/FR-014, S-05)
- Any `preuninstall`/`postuninstall` npm hook (OQ-7 — resolved "no hook")
- Copy / `npx` / manifest-less repos (S-04)
- Changes to `ToolkitManifest` or the sentinel constants
- Removing the dependency from `package.json` / `package-lock.json`

## Architecture / Approach

`runUninstall()` = inverse of `runInstall()`, driven only by `manifest.files[]`.
Per-entry dispatch on the path string: `.claude/skills/*` → ownership-probe then
`rmSync`; `CLAUDE.md` → `removeRulesBlock` (CRLF-agnostic mirror of
`applyRulesBlock`); `.npmrc` → `removeNpmrcLines` (exact-line match). Then
guarded shallow `rmdir` of `.claude/skills/` and `.claude/`, then delete the
manifest. Wrapped in try/catch — never throws, failures downgrade to
`console.warn`, same contract as install.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Extract shared helpers | `src/consumer.ts` with `findConsumerRoot` + path/EOL helpers; `install.ts` re-imports | A move that silently changes install behaviour — mitigated: install tests don't import internals, must stay green |
| 2. Uninstall core + CLI | Real `runUninstall()`, `cli.ts` text, `test/uninstall.test.ts` | Deleting or corrupting the consumer's own `CLAUDE.md` / `.npmrc` content — mitigated by exact block/line matching + empty-only deletion + round-trip tests |
| 3. Docs + roadmap | README uninstall section, status/layout/context, roadmap S-03 → in-progress | Doc drifts from behaviour — caught in manual review |

**Prerequisites:** S-01 + S-02 landed (they are, commits through `8059411`).
**Estimated effort:** ~1 session across 3 commits.

## Open Risks & Assumptions

- Manifest can drift from reality if the consumer hand-edits an installed file;
  S-03 removes what it can and warns on the rest — FR-013 (S-05) is the fuller
  answer, deliberately deferred.
- Assumes the MVP payload only ever produces the three manifest-path shapes
  (`.claude/skills/<name>`, `CLAUDE.md`, `.npmrc`); an unexpected entry is
  warned and left in place.
- `.claude/` is only removed when completely empty — a consumer keeping other
  tooling there keeps the directory.

## Success Criteria (Summary)

- After `ai-toolkit install` + commit + `ai-toolkit uninstall`, version control
  shows no package artifact — links, block, `.npmrc` lines, and manifest all
  gone; hand-written content in shared files is byte-identical.
- A second `ai-toolkit uninstall` is a clean no-op ("no manifest found").
- Holds in a CRLF consumer repo — only intended removals appear in the diff.
