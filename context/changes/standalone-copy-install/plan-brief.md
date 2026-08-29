# Standalone copy install (S-04) — Plan Brief

> Full plan: `context/changes/standalone-copy-install/plan.md`

## What & Why

A consumer with a **non-Node repo** (Python / Go / Rust — no `package.json`) must
be able to run `npx @10xpackages/ai-toolkit install` and get the same team
artifacts under `.claude/` as a roaming (`npm install`) consumer does. FR-005
makes both modes must-have; copy mode is the only one that works without a
package manager and from `npx`'s ephemeral cache. This change adds copy mode by
reusing the S-01/S-02/S-03 reconcile engine with a different skill-materialisation
strategy and a different root-resolution rule.

## Starting Point

S-01–S-03 shipped the full roaming pipeline in `src/install.ts` /
`src/uninstall.ts`: `runInstall()` runs `linkSkills` → `applyRulesBlock` →
`ensureNpmrc` → `pruneWithdrawn` → `writeManifest`, never throws, is idempotent
(incl. CRLF repos), and writes a frozen five-field `ToolkitManifest` whose
`files[]` uninstall reverses exactly. `src/consumer.ts` holds the shared
root-discovery + line-ending helpers. `findConsumerRoot()` resolves the consumer
root by walking up to an ancestor `node_modules` — which, under `npx`, resolves
to the **cache dir, not the user's project**. Skills are symlinks/junctions into
`node_modules`; the manifest lists them by **directory**.

## Desired End State

`runInstall({ copy? })` resolves a `{ root, mode }` target and runs the same
ordered reconcile. In copy mode the payload skills are **copied as real files**
into `<cwd>/.claude/skills/<name>/…`, the `CLAUDE.md` block is injected as usual,
**no `.npmrc`** is written unless a `package.json` is present, and the manifest
lists every copied **file**. `npx @10xpackages/ai-toolkit uninstall` in that repo
reads the manifest and removes exactly those files, the block, the emptied dirs,
and the manifest. Roaming mode (`npm install` → `postinstall`) is byte-for-byte
unchanged. A second install in either mode is a zero-write no-op; running from
the toolkit checkout stays a logged no-op.

## Key Decisions Made

All decisions taken autonomously under the `/goal` human-out-of-loop directive,
grounded in the roadmap (S-04), PRD (FR-005, Guardrails, NFR), shape-notes, and
the S-01–S-03 codebase.

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Mode selector | `{ root, mode }` from `resolveTarget()`: forced by `--copy`; else `PROJECT_ROOT` ⇒ link; else ancestor `node_modules` **and cwd nested under it** ⇒ link; else cwd ⇒ copy | Containment is the only reliable "am I a real dependency of *this* project" signal — `npx` runs from a cache whose `node_modules` is not an ancestor of cwd | Plan |
| Skill materialisation in copy mode | Recursive **content-diffing** copy (`syncDir`: write only on byte difference, remove orphans, rmdir emptied) | Real files (symlink into `npx` cache would dangle); byte-compare keeps the idempotency NFR at file level, not just git level | Roadmap / PRD NFR |
| Manifest entry shape | Copy mode lists **per-file** paths (`.claude/skills/<n>/<f>`); link mode keeps **per-dir** | No `ToolkitManifest` change (frozen); uninstall/prune tell modes apart by path **depth**; every S-03 test keeps its behaviour | Plan / Frozen contract |
| `.npmrc` in copy mode | Written **only when `<root>/package.json` exists** | The registry line needs a package manager to matter; a manifest-less repo has none — also drops copy mode out of OQ-4's credential-line concern | PRD FR-006 scope |
| `process.cwd()` as the copy target | Yes; guard the toolkit checkout by reading `<cwd>/package.json` `name === PACKAGE_NAME` ⇒ no-op | `npx` preserves the invocation cwd; the name check preserves the `entrypoints.test.ts` no-op | Plan |
| CLI surface | Add `--copy` to `install` only; bare `npx … install` in a no-`package.json` repo auto-selects copy | "jednym poleceniem" (roadmap) — no flag needed in the canonical case; `--copy` forces it in a Node repo | Roadmap |
| Uninstall root resolution | `findConsumerRoot()` reimplemented as `resolveTarget()?.root ?? null` — inherits the `npx`/cwd fallback with no edit to `uninstall.ts` logic | One resolution rule for both entrypoints (the S-03 "single owner of the walk" principle) | S-03 plan |
| `pruneWithdrawn` on copy entries | A stale **deep** `.claude/skills/<n>/<f>` entry ⇒ delete the file + rmdir emptied dirs (not the S-02 "now a real dir" warn) | A deep entry is a file this package wrote; the warn path stays for the exact-dir case | Plan |
| Rich unsafe-state handling | Out — copy mode reuses the S-01 minimum (malformed block → warn+skip; name collision → warn+skip) | FR-012/013/014 + full collision policy are S-05 | Roadmap |

## Scope

**In scope:** `resolveTarget()` with containment + copy fallback + toolkit-checkout
guard; `copySkills` / `syncDir` content-diffing copy engine; `--copy` CLI flag;
`.npmrc` gate on `package.json`; per-file manifest entries; copy-aware
`runUninstall` + `pruneWithdrawn` (depth dispatch, empty-dir prune); new
copy-mode suites in `test/install.test.ts` + `test/uninstall.test.ts`; README
"Standalone copy install" section; roadmap S-04 status.

**Out of scope:** any change to roaming/symlink mode behaviour or its tests;
`ToolkitManifest` / sentinel constant changes; `.npmrc` surgery in the
manifest-less case; `npx` cache management; FR-012/FR-013/FR-014 + full
name-collision policy (S-05); CI / publish (S-06/S-07); multi-tool profiles.

## Architecture / Approach

`src/consumer.ts` gains `resolveTarget({ copy? }) → { root, mode } | null` and
`findConsumerRoot()` becomes a thin wrapper over it. `src/install.ts` gains
`copySkills` (+ `syncDir` + a prior-manifest collision check), `runInstall` takes
`options`, branches skill materialisation on `mode`, and gates `ensureNpmrc`;
`pruneWithdrawn` learns depth dispatch. `src/uninstall.ts` learns the same depth
dispatch + an empty-dir prune. `src/cli.ts` parses `--copy`. No new module, no
new dependency. Three phases = three commits, matching the S-01/S-02/S-03 rhythm.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Mode resolution + copy engine | `resolveTarget`, `copySkills`/`syncDir`, `--copy`, `.npmrc` gate, per-file manifest + tests | Mis-detecting a real dependency install as copy (or vice-versa); regressing link-mode entry shape |
| 2. Copy-aware uninstall + prune | Depth dispatch in `runUninstall` + `pruneWithdrawn`, empty-dir prune + tests | Deleting a consumer-owned dir; breaking an S-03 test that lists a bare `.claude/skills/<name>` |
| 3. Docs + roadmap | README section + Status/Layout/Context refresh; S-04 → in-progress | `.npmrc`/`package.json` rule or "cwd is the target" stated unclearly |

**Prerequisites:** S-01/S-02/S-03 (done, green). No new dependencies.
**Estimated effort:** ~1 session across 3 phases; three separate commits.

## Open Risks & Assumptions

- **`npx` cwd semantics** — assumes `npx @10xpackages/ai-toolkit install` runs
  with `process.cwd()` = the directory the user invoked it from (true for npm's
  `npx`/`npm exec`). Phase 1 manual verification exercises the real path.
- **Containment check for the `postinstall` hook** — assumes npm runs our
  package's `postinstall` with cwd nested under the consumer root (it is
  `<root>/node_modules/@10xpackages/ai-toolkit`). If a future npm changes this,
  link mode would fall through to copy; the `PROJECT_ROOT` and `--copy` paths are
  unaffected.
- **Single skill / single file payload today** — the copy engine must not assume
  it; tests seed a nested fixture to prove recursion + empty-dir prune.
- **Mixing modes in one repo across installs** is outside MVP intent but degrades
  safely — uninstall handles both entry shapes by depth.
- **`cwd` as target** has the usual "run it from the right directory" foot-gun;
  mitigated by the toolkit-checkout name guard and a README caveat, not by a
  path allowlist.

## Success Criteria (Summary)

- `npx @10xpackages/ai-toolkit install` in a repo with **no `package.json`**
  lays out skills as real files under `.claude/skills/<name>/`, injects the
  `CLAUDE.md` block, writes a per-file manifest, and adds **no** `.npmrc`.
- A second install produces **zero** VCS diff (both modes, incl. CRLF repos).
- `npx @10xpackages/ai-toolkit uninstall` leaves the repo with no package trace
  and the developer's own `CLAUDE.md` content intact.
- Every existing S-01/S-02/S-03 test passes unchanged; roaming mode is
  byte-for-byte identical.
