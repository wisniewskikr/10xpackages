# Standalone copy install (S-04) Implementation Plan

## Overview

Add a second install mode to `@10xpackages/ai-toolkit`: **standalone copy**. A
consumer runs `npx @10xpackages/ai-toolkit install` in a project that has **no
`package.json`** (a Python / Go / Rust repo) and gets the same artifacts laid out
under `.claude/` — skills as **real copied files** (not symlinks into
`node_modules`, which does not exist here and whose `npx` cache is ephemeral), the
sentinel-fenced team-rules block in `CLAUDE.md`, and an install manifest that
`uninstall` reads back.

S-01 built the roaming (symlink) reconcile and froze the `ToolkitManifest`
contract; S-02 added the withdrawn-artifact prune and CRLF-agnostic editing;
S-03 built the manifest-driven uninstaller and extracted `src/consumer.ts`.
S-04 reuses that whole engine: copy mode is the same ordered reconcile with a
different skill-materialisation strategy and a different root-resolution rule.

## Current State Analysis

- **`src/install.ts`** — `runInstall(): Promise<void>` runs an ordered reconcile
  against the consumer root: `linkSkills` → `applyRulesBlock` → `ensureNpmrc` →
  `pruneWithdrawn` → `writeManifest`. Never throws (failures downgrade to
  `console.warn` so a consumer's `npm install` can't break). `linkSkills`
  (`:38`) symlinks/junctions each payload skill dir into `.claude/skills/<name>`
  and returns `[".claude/skills/<name>"]` (one entry per skill **directory**).
- **`src/consumer.ts`** — shared primitives: `findConsumerRoot()` (`:27`)
  resolves the consumer root as `PROJECT_ROOT` → nearest ancestor `node_modules`
  parent → `null`; `MANIFEST_RELPATH`, `SKILLS_RELDIR`, `toManifestPath`,
  `stripCr`, `toCrlf`.
- **`src/uninstall.ts`** — `runUninstall()` reads the manifest and reverses each
  `files[]` entry: `.claude/skills/*` → ownership-probe (`fs.readlinkSync`
  succeeds ⇒ link ⇒ `rmSync`; throws ⇒ real entry ⇒ warn + leave); `CLAUDE.md` →
  strip the fenced block; `.npmrc` → remove the two known lines; then rmdir
  emptied `.claude/skills/` and `.claude/`, delete the manifest last.
- **`src/cli.ts`** — `run(argv)` dispatches `argv[2]` (`install` / `uninstall` /
  `--help`). No flag parsing today.
- **`src/manifest.ts`** — `ToolkitManifest = { package, version, tool,
  installedAt, files[] }`. **Frozen**; `test/manifest.test.ts` locks the
  five-field literal — and its example `files[]` already contains a *per-file*
  path (`.claude/skills/code-review/SKILL.md`), so per-file entries need no
  interface change.
- **Payload** — `skills/code-review/SKILL.md`, `rules/CLAUDE.md` (one skill, one
  file each today; the design must not assume that).
- **`bin/ai-toolkit.js`** — thin `require("../dist/cli.js")`; fail-soft. No
  change needed.
- **`package.json`** — `postinstall` = `node bin/ai-toolkit.js install`;
  `files` allowlist = `dist/ skills/ rules/ bin/ README.md`.
- **`.claude/config-templates/m5l4-github-packages-install.js.template`** — the
  reference copy-mode shape: `findProjectRoot()` falls back to `process.cwd()`;
  `copyDir()` recurses and pushes `path.relative(root, dst)` **per file**;
  `installSkills()` does `fs.rmSync(target, …)` then `copyDir`. S-04 adapts this
  (content-compare instead of blind rm+copy, collision guard, empty-dir prune).
- **PRD grounding** — FR-005 (both modes; copy "działa też w projekcie bez
  manifestu projektu"), US-02, plus the Guardrails: **idempotency** (run twice →
  zero VCS diff), **no secret in repo**, **gentle coexistence**. Roadmap S-04:
  *"jednym poleceniem `npx <paczka> install` … układa te same artefakty … w
  projekcie bez manifestu projektu"*; risk noted — *"rozjechanie się dwóch
  trybów — wspólny silnik to mityguje"*.
- **No `research.md` / `frame.md`** — upstream grounding is
  `context/foundation/{roadmap.md,prd.md,shape-notes.md}` and the S-01/S-02/S-03
  plans.

### Key Discoveries:

- **The `node_modules` walk finds the *wrong* root under `npx`.** `npx
  @10xpackages/ai-toolkit install` materialises the package in an `npx` cache
  (`…/_npx/<hash>/node_modules/@10xpackages/ai-toolkit`); `findConsumerRoot()`'s
  walk resolves the parent of *that* `node_modules` — the cache dir, not the
  user's project. The reliable signal for "am I a real dependency of the project
  I'm being run from" is **containment**: is `process.cwd()` inside the walk
  result? A genuine dependency install (incl. the `postinstall` hook, whose cwd
  is `<proj>/node_modules/@10xpackages/ai-toolkit`) is inside it; an `npx` run
  from a foreign project is not. When it is not, the target is `process.cwd()`
  and the mode is copy.
- **Per-file manifest entries are the clean discriminator.** Copy mode lists
  every copied file (`.claude/skills/<name>/<path>`); link mode lists the
  directory (`.claude/skills/<name>`). Uninstall and prune then tell the two
  apart purely by **path depth** — no new manifest field, and every existing
  S-03 test (which lists `.claude/skills/mine` *exactly*) keeps its behaviour.
- **`applyRulesBlock` is already mode-agnostic** — it writes `<root>/CLAUDE.md`.
  Copy mode calls it unchanged.
- **`.npmrc` is meaningless without a package manager.** The registry-mapping
  line lets a *dependency* consumer re-resolve the package; a manifest-less repo
  has no npm to read it. Copy mode runs `ensureNpmrc` **only when
  `<root>/package.json` exists** (a Node repo that forced `--copy` still gets
  it). This also removes copy mode from OQ-4's conditional-credential-line
  concern entirely for the canonical case.
- **`writeManifest` / `pruneWithdrawn` already content-compare and only write on
  change** — copy mode's skill sync must do the same (compare bytes per file) to
  hold the idempotency NFR at the file level, not just the git level.
- **Our own checkout must stay a no-op.** With no `PROJECT_ROOT` and no ancestor
  `node_modules`, distinguish "toolkit repo" from "manifest-less consumer" by
  reading `<cwd>/package.json` `name` — equal to `PACKAGE_NAME` ⇒ `null` no-op
  (preserves the `entrypoints.test.ts` "resolves without throwing" +
  "toolkit checkout" behaviour).

## Desired End State

`runInstall(options?: { copy?: boolean })` resolves a **target** — `{ root,
mode }` — and runs the same ordered reconcile, materialising skills per `mode`:

- `npx @10xpackages/ai-toolkit install` in a repo with **no `package.json`** (or
  any repo, with `--copy`): each payload skill dir is **copied** to
  `<cwd>/.claude/skills/<name>/…` as real files; `CLAUDE.md` gets the fenced
  block; **no `.npmrc`** unless a `package.json` is present; the manifest lists
  every copied file plus `CLAUDE.md` (and `.npmrc` when written), sorted, POSIX,
  root-relative.
- A standard dependency install (`npm install` → `postinstall` hook) is
  **unchanged**: symlink/junction mode into `node_modules`, `.npmrc` line,
  dir-level manifest entries — byte-for-byte as S-01/S-02/S-03 left it.
- `npx @10xpackages/ai-toolkit uninstall` in the manifest-less repo reads
  `<cwd>/.claude/.ai-toolkit-manifest.json` and removes exactly the copied
  files, the `CLAUDE.md` block, then the emptied `.claude/skills/<name>/`,
  `.claude/skills/`, `.claude/`, and the manifest — leaving the developer's own
  content untouched.
- **Idempotency**: a second `install` (either mode) on a clean tree writes
  nothing — copied files are byte-compared, the rules block and manifest are
  unchanged — so `git status` is clean. Holds on CRLF repos (inherited from
  S-02).
- Running from a checkout of the toolkit repo itself stays a logged no-op.

**Verification**: `npm test` (new copy-mode suites in `test/install.test.ts` and
`test/uninstall.test.ts`), `npm run typecheck`, `npm run build`, `npm pack
--dry-run` allowlist unchanged; plus a manual real copy-install into a scratch
*Python* repo (no `package.json`) on Windows — skills present as real files,
`CLAUDE.md` block, no `.npmrc`, re-run diff-free, `uninstall` leaves the tree
clean (folds in OQ-4 for copy mode).

## What We're NOT Doing

- **No change to symlink/roaming mode** — S-01/S-02/S-03 behaviour, entry shape,
  and tests are untouched. Copy mode is strictly additive.
- **No change to `ToolkitManifest` or the sentinel constants** (`src/manifest.ts`
  frozen; `test/manifest.test.ts` locks it). No `mode` field — path depth is the
  discriminator.
- **No `.npmrc` surgery in the manifest-less case** — the registry line needs a
  package manager to matter. It is still written when a `package.json` is
  present.
- **No `npx`-cache cleanup, no re-download avoidance, no offline mode** — `npx`
  owns its cache lifecycle.
- **No rich unsafe-state handling** — corrupted-block abort with a file/line
  pointer (FR-012), sentinel-injection guard (FR-014), full skill-name-collision
  policy, corrupted-manifest candidate listing (FR-013) are all S-05. Copy mode
  reuses the S-01 minimum: malformed rules block → warn + skip; skill-name
  collision → warn + skip.
- **No multi-tool profiles**, no `prompts/` / `config-templates/` payload — PRD
  Non-Goals.
- **No CI / publish / consumer-auth design** — S-06 / S-07.
- **No `--copy` support on `uninstall`** — uninstall probes each manifest entry
  and needs no mode hint; it only needs the same root resolution.

## Implementation Approach

Three commits, in the S-01/S-02/S-03 rhythm:

1. **Mode resolution + copy engine.** `src/consumer.ts` gains `resolveTarget({
   copy? })` returning `{ root, mode: "link" | "copy" } | null`;
   `findConsumerRoot()` becomes a thin wrapper (`resolveTarget()?.root ?? null`)
   so `uninstall.ts` inherits the `npx`/cwd fallback with no edit. `src/install.ts`
   gains `copySkills` (+ a `syncDir` byte-compare helper + a prior-manifest
   collision check), takes `options`, branches skill materialisation on `mode`,
   and gates `ensureNpmrc` on `mode === "link" || <root>/package.json exists`.
   `src/cli.ts` parses `--copy`. New copy-mode suite in `test/install.test.ts`.
2. **Copy-aware uninstall + prune.** `src/uninstall.ts` handles deep
   (`.claude/skills/<name>/…`) entries as file removals and prunes emptied dirs;
   `pruneWithdrawn` in `src/install.ts` does the same for stale deep entries.
   New copy-mode round-trip suite in `test/uninstall.test.ts`; a withdrawn
   copied-file case in `test/install.test.ts`.
3. **Docs + roadmap.** `README.md` `### Standalone copy install` section +
   `## Status` / `## Layout` / `## Context` refresh; roadmap S-04 →
   `in-progress` (committed with Phase 1 per the 10x flow).

## Critical Implementation Details

- **Target resolution order** (in `resolveTarget`): `opts.copy` ⇒ `{ root:
  PROJECT_ROOT ?? process.cwd(), mode: "copy" }`. Else `PROJECT_ROOT` set ⇒
  `{ root: PROJECT_ROOT, mode: "link" }` (test path, unchanged). Else walk
  `__dirname` up for an ancestor dir named `node_modules`; if found **and**
  `process.cwd()` is that parent or nested under it ⇒ `{ root: <parent>, mode:
  "link" }`. Else if `<cwd>/package.json` `name` === `PACKAGE_NAME` ⇒ `null`
  (toolkit checkout). Else ⇒ `{ root: process.cwd(), mode: "copy" }`. Containment
  test: `child === parent || child.startsWith(parent + path.sep)`.
- **`syncDir(srcDir, dstDir)` is a content-diffing copy, not rm+copy.** Recurse
  `srcDir`; for each file, write only when the destination is missing or its
  bytes differ (`Buffer.equals`). Then remove destination files with no source
  counterpart and `rmdir` any dir emptied by that. This makes a clean re-run a
  zero-write no-op (idempotency NFR) and reconciles a skill that dropped a file
  between versions.
- **Copy collision guard.** Before syncing skill `<name>`, if
  `<root>/.claude/skills/<name>` exists and **no** path in the *prior* manifest's
  `files[]` starts with `.claude/skills/<name>/`, it is the consumer's own —
  `console.warn` and skip (omit from the returned list). Otherwise it is ours (or
  brand new) — sync it. Read the prior manifest once per `runInstall`.
- **Manifest entry shape by mode.** `linkSkills` returns
  `[".claude/skills/<name>"]` (dir). `copySkills` returns
  `[".claude/skills/<name>/<relpath>", …]` (files). `writeManifest` sorts —
  no other change.
- **Uninstall / prune discriminate by depth.** For a manifest entry under
  `.claude/skills/`: `split("/").length === 3` ⇒ link-mode dir entry — existing
  `readlinkSync` probe (link ⇒ `rmSync`; real ⇒ warn + leave). `length > 3` ⇒
  copy-mode file — `rmSync(abs, { force: true })` if present. After the loop,
  recursively `rmdir` empty dirs under `.claude/skills/` before the existing
  `.claude/skills/` + `.claude/` cleanup.
- **Never-throws contract holds** — copy mode adds only `fs` calls inside the
  existing `runInstall` / `runUninstall` try/catch.

## Phase 1: Mode resolution + copy engine (skills, rules, manifest)

### Overview

Introduce `{ root, mode }` target resolution, implement `copySkills` +
`syncDir`, wire the mode branch and the `.npmrc` gate into `runInstall`, and add
`--copy` to the CLI. After this phase `npx @10xpackages/ai-toolkit install` in a
manifest-less repo lays out skills as real files, injects the rules block, and
writes a per-file manifest — while `npm install` roaming mode is untouched.

### Changes Required:

#### 1. Target resolution

**File**: `src/consumer.ts`

**Intent**: Own the decision of *where* artifacts go and *how* skills are
materialised, so both entrypoints share one rule and the `npx`/cwd fallback is
defined once. Replace the bare `node_modules`-walk assumption with a
containment check, add the copy-mode fallback to `process.cwd()`, and keep the
toolkit-checkout no-op.

**Contract**:
- `export type InstallMode = "link" | "copy";`
- `export interface ResolvedTarget { root: string; mode: InstallMode; }`
- `export function resolveTarget(opts?: { copy?: boolean }): ResolvedTarget | null`
  — resolution order exactly as "Critical Implementation Details" above.
- `export function findConsumerRoot(): string | null` — reimplemented as
  `resolveTarget()?.root ?? null`. Existing signature and every existing caller
  unchanged; `uninstall.ts` transparently gains the cwd fallback.
- Internal helpers: an ancestor-`node_modules` walk (the current loop body) and
  a `readPackageName(dir): string | null` (`JSON.parse` of `<dir>/package.json`,
  any failure ⇒ `null`).

#### 2. Copy engine + mode branch

**File**: `src/install.ts`

**Intent**: Add `copySkills(consumerRoot)` (real-file materialisation with a
content-diffing `syncDir` and the prior-manifest collision guard), make
`runInstall` accept `options`, resolve a target, branch skill materialisation on
`target.mode`, and gate `ensureNpmrc`. Preserve the never-throws wrapper and the
existing log line shape (wording may vary by mode).

**Contract**:
- `export async function runInstall(options?: { copy?: boolean }): Promise<void>`
  — default `{}`; back-compatible with every existing `runInstall()` call.
- `const target = resolveTarget(options); if (target === null) { console.log(<toolkit-checkout notice>); return; }`
- `const { root, mode } = target;` then
  `files.push(...(mode === "copy" ? copySkills(root) : linkSkills(root)));`
- `applyRulesBlock(root)` — unchanged call.
- `.npmrc` gate: `if (mode === "link" || fs.existsSync(path.join(root, "package.json"))) files.push(...ensureNpmrc(root));`
- `pruneWithdrawn(root, files)` then `writeManifest(root, files)` — unchanged
  calls (Phase 2 teaches `pruneWithdrawn` about deep entries).
- `copySkills(consumerRoot: string): string[]` — for each directory under the
  payload `skills/`: resolve `<consumerRoot>/.claude/skills/<name>`; apply the
  collision guard (prior manifest read via a small local helper, e.g.
  `readPriorManifestFiles(consumerRoot): string[]`); on a keep, `syncDir` and
  push every resulting file path as `toManifestPath(...)`. Returns the flat,
  consumer-root-relative POSIX file list.
- `syncDir(srcDir: string, dstDir: string): string[]` — recursive
  content-compare copy + orphan removal + empty-dir `rmdir`; returns absolute
  paths of files now present (caller maps to manifest paths). Uses
  `fs.readFileSync` + `Buffer.equals`.
- No change to `linkSkills`, `applyRulesBlock`, `ensureNpmrc`, `writeManifest`.

#### 3. CLI flag

**File**: `src/cli.ts`

**Intent**: Let `install` take `--copy` to force copy mode; thread it to
`runInstall`. Refresh `USAGE`.

**Contract**: parse `argv.slice(3).includes("--copy")`; `case "install": await
runInstall({ copy });`. `USAGE` gains a line for `install --copy` ("Copy
artifacts into this project instead of symlinking (for repos without a
package.json)") and a note that a bare `npx @10xpackages/ai-toolkit install` in a
repo with no `package.json` auto-selects copy mode. No dispatch changes for
`uninstall` / `--help`.

#### 4. Copy-mode install tests

**File**: `test/install.test.ts`

**Intent**: Lock copy-mode materialisation, the per-file manifest, idempotency,
the collision guard, and the `.npmrc` gate — without disturbing the existing
link-mode suites.

**Contract**: new `describe("runInstall — standalone copy mode (S-04)")`,
tmpdir root via `PROJECT_ROOT`, `runInstall({ copy: true })`, `console` mocked,
env restored in `afterEach` (mirror the existing suites). Cases:
- copy creates `.claude/skills/code-review/SKILL.md` as a **real file**
  (`lstatSync(...).isSymbolicLink() === false`) whose bytes equal the payload's.
- manifest `files[]` contains `.claude/skills/code-review/SKILL.md` (the file,
  not the bare dir) and `CLAUDE.md`; sorted.
- idempotent re-run: capture each copied file's bytes + the manifest bytes after
  run 1; after run 2 all are byte-identical (no `git`-visible change).
- collision: pre-create `.claude/skills/code-review/SKILL.md` with `"# mine\n"`
  and **no** prior manifest → `console.warn`, file left as `"# mine\n"`, absent
  from `files[]`.
- `.npmrc` gate: with no `<root>/package.json` → no `.npmrc` written, `.npmrc`
  absent from `files[]`; with a `<root>/package.json` present → `.npmrc`
  contains the registry line and is in `files[]`.
- regression sanity: one assertion that `runInstall()` (no options) with
  `PROJECT_ROOT` set still produces the **link** entry `.claude/skills/code-review`
  (dir) — proves the default path is unchanged.

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Type check passes: `npm run typecheck`
- Test suite passes, incl. the new copy-mode suite and every existing
  install/uninstall/entrypoints test unchanged: `npm test`
- `npm pack --dry-run --json` still lists only `dist/`, `skills/`, `rules/`,
  `bin/`, `README.md`, `package.json`

#### Manual Verification:

- In a scratch dir with **no `package.json`**, `PROJECT_ROOT=<dir> node
  bin/ai-toolkit.js install --copy` creates `.claude/skills/code-review/SKILL.md`
  as a real file, a `CLAUDE.md` block, a per-file manifest, and **no** `.npmrc`;
  re-running leaves `git status` clean
- On Windows, copy mode needs no Developer Mode / elevation (no symlink call)

**Implementation Note**: After Phase 1 automated verification passes, the
implementer records the manual check in-session (under the `/goal`
human-out-of-loop directive) and proceeds to Phase 2.

---

## Phase 2: Copy-aware uninstall + withdrawn-artifact prune

### Overview

Teach `runUninstall` and `pruneWithdrawn` to handle per-file
(`.claude/skills/<name>/…`) manifest entries, so a copy install round-trips to
zero trace and a copy "update" (`npx … install` again) drops withdrawn files.

### Changes Required:

#### 1. Copy-aware uninstall

**File**: `src/uninstall.ts`

**Intent**: For a manifest entry under `.claude/skills/`, dispatch on path
depth: exact `.claude/skills/<name>` keeps the existing link ownership-probe;
deeper paths are copied files → remove them. After the per-entry loop,
recursively remove emptied directories under `.claude/skills/` before the
existing `.claude/skills/` + `.claude/` cleanup.

**Contract**:
- In the `relPath.startsWith(SKILLS_POSIX_PREFIX)` branch: if
  `relPath.split("/").length > 3` → `if (fs.existsSync(abs)) { fs.rmSync(abs, {
  force: true }); removed++; }` (a plain file; no `recursive`). Else → the
  current `readlinkSync` probe, unchanged.
- New local `removeEmptyDirsUnder(absSkillsDir: string): void` — post-order walk;
  `rmdirSync` any directory left empty. Called once, after the loop, before the
  existing `[SKILLS_RELDIR, ".claude"]` rmdir loop. Wrapped so a non-empty dir
  is a silent no-op.
- `CLAUDE.md` / `.npmrc` / unknown-entry handling and the manifest-deleted-last
  ordering are unchanged.

#### 2. Prune-aware-of-copied-files

**File**: `src/install.ts`

**Intent**: `pruneWithdrawn` currently warns "is now a real directory not
managed" for any stale `.claude/skills/*` entry that is not a link. A stale
*deep* entry is a copied file this package wrote — delete it instead.

**Contract**: in the stale-entry loop, when `relPath` starts with
`.claude/skills/` and `relPath.split("/").length > 3` → `fs.rmSync(abs, {
force: true })` if it exists (no warn); keep the existing link-probe /
real-directory-warn path for the exact `.claude/skills/<name>` case. Reuse the
Phase 2 `removeEmptyDirsUnder` (export it from `consumer.ts`, or duplicate the
tiny helper — prefer sharing via `consumer.ts`) for the post-prune cleanup so an
emptied `.claude/skills/<name>/` is removed. The existing "remove emptied
`.claude/skills/`" tail stays.

#### 3. Copy-mode uninstall + prune tests

**File**: `test/uninstall.test.ts`, `test/install.test.ts`

**Intent**: Prove the copy round-trip leaves no trace, shared files survive, and
a withdrawn copied file is pruned on re-install.

**Contract** — `test/uninstall.test.ts`, new
`describe("runUninstall — standalone copy mode (S-04)")`:
- round-trip: `runInstall({ copy: true })` then `runUninstall()` →
  `.claude/skills/`, `.claude/`, and the manifest are gone; a second
  `runUninstall()` logs "no manifest found" and resolves.
- preserves hand-written `CLAUDE.md`: seed `# Mine\n\nkeep\n`, copy-install,
  uninstall → file equals the seed.
- a copied nested tree is fully removed: seed a payload-like skill with a
  sub-directory via a temp fixture (or assert on `code-review/SKILL.md` only if
  the payload stays single-file) → after uninstall `.claude/` does not exist.
- unchanged S-03 guard: a manifest listing `.claude/skills/mine` **exactly**,
  present as a real dir with a consumer file → still warned + left in place.

**Contract** — `test/install.test.ts`, added to the copy-mode suite:
- withdrawn copied file: seed a prior manifest listing
  `.claude/skills/code-review/SKILL.md` **and**
  `.claude/skills/legacy/OLD.md`, create `.claude/skills/legacy/OLD.md` as a
  real file, `runInstall({ copy: true })` → `OLD.md` and the emptied
  `.claude/skills/legacy/` are gone, `code-review/SKILL.md` remains, manifest no
  longer lists `OLD.md`.

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Type check passes: `npm run typecheck`
- Test suite passes, incl. the new copy-mode uninstall/prune tests and every
  existing test unchanged: `npm test`
- `npm pack --dry-run --json` allowlist unchanged

#### Manual Verification:

- Scratch repo with **no `package.json`**: `install --copy`, `git init && git
  add -A && git commit`, then `node bin/ai-toolkit.js uninstall` → `git status`
  clean, `git clean -nd` empty, `.claude/` gone
- A hand-written `CLAUDE.md` above the block survives uninstall with only the
  block removed (`git diff` shows just that)

**Implementation Note**: After Phase 2 automated verification passes, the
implementer records the manual check in-session and proceeds to Phase 3.

---

## Phase 3: Documentation + roadmap

### Overview

Document standalone copy mode in `README.md` and refresh the status / layout /
context notes. Advance the roadmap. No code.

### Changes Required:

#### 1. README — "Standalone copy install" section

**File**: `README.md`

**Intent**: Tell a consumer with a non-Node repo how to use copy mode: `npx
@10xpackages/ai-toolkit install` from the project root copies each skill into
`.claude/skills/<name>/` as **real files**, inserts the `CLAUDE.md` block, and
writes `.claude/.ai-toolkit-manifest.json`; **no `.npmrc`** line is added unless a
`package.json` is present; `--copy` forces the mode in a Node repo; the target is
the current working directory, so run it from the project root; re-running is
diff-free; `npx @10xpackages/ai-toolkit uninstall` reverses it from the manifest.
Contrast with roaming mode in one line (copies don't follow `npm update` — re-run
`install` to refresh).

**Contract**: new `### Standalone copy install` subsection under `## Consumer
setup`, after `### Consumer uninstall`. Refresh `## Status` (S-04 lands; still
pending S-05). Update `## Layout` — `install.ts` comment notes "copy + symlink
modes"; add nothing new to the file tree (no new module beyond the existing
`consumer.ts`). Update `## Context` to list `standalone-copy-install/` (S-04).

#### 2. Roadmap status

**File**: `context/foundation/roadmap.md`

**Intent**: S-04 moves from `planning` (set at plan time) to `in-progress` on the
first implementation commit.

**Contract**: `## At a glance` row S-04 Status cell → `in-progress`; item body
`### S-04:` `- **Status:**` line → `in-progress`; frontmatter `updated:` → the
commit date. (Per the 10x flow this edit is committed with **Phase 1**; listed
here for completeness.)

### Success Criteria:

#### Automated Verification:

- `npm run build && npm test` still green (no code touched, sanity only)
- `npm pack --dry-run --json` allowlist unchanged

#### Manual Verification:

- README "Standalone copy install" section matches the implemented behaviour;
  the `.npmrc`-only-with-package.json rule and the "cwd is the target" caveat are
  unambiguous; the scope boundary with S-05 (unsafe-state refusals) is clear
- `## Status`, `## Layout`, `## Context` reflect S-04 implemented

**Implementation Note**: Final phase — after verification the change is ready for
`/10x-impl-review`.

---

## Testing Strategy

### Unit / integration tests (Vitest, node env, tmpdir root via `PROJECT_ROOT`)

- **Copy materialisation** (`test/install.test.ts`): real files not symlinks;
  bytes equal payload; per-file manifest entries; idempotent re-run
  (byte-identical files + manifest); collision → warn + skip + absent from
  `files[]`; `.npmrc` gated on `package.json`.
- **Link mode regression**: the existing S-01/S-02 suites plus one explicit
  "default `runInstall()` still emits the dir-level `.claude/skills/code-review`
  entry" assertion.
- **Copy uninstall** (`test/uninstall.test.ts`): round-trip → zero trace; second
  run no-op; hand-written `CLAUDE.md` preserved; nested copied tree fully
  removed; the exact-`.claude/skills/<name>` real-dir S-03 guard still warns +
  leaves.
- **Copy prune** (`test/install.test.ts`): a withdrawn copied file + its emptied
  dir are removed on re-install; surviving skill untouched.
- **Entrypoints**: `runInstall()` / `runUninstall()` still resolve without
  throwing when `PROJECT_ROOT` is unset (toolkit-checkout no-op via the
  `package.json` name check).

### Manual testing steps

1. `npm run build`. In an empty scratch dir with **no `package.json`**:
   `PROJECT_ROOT=<dir> node bin/ai-toolkit.js install --copy`.
2. Confirm `.claude/skills/code-review/SKILL.md` is a real file equal to the
   payload, `CLAUDE.md` has the fenced block, `.claude/.ai-toolkit-manifest.json`
   lists per-file paths, and there is **no** `.npmrc`.
3. `git init && git add -A && git commit -m x`; re-run the install → `git status`
   clean (idempotency + NFR).
4. Add a hand-written section to `CLAUDE.md` above the block, re-run → the
   section is untouched, block appears once.
5. `node bin/ai-toolkit.js uninstall` → `.claude/` gone, `CLAUDE.md` back to just
   the hand-written section (or removed if it was block-only), manifest gone,
   `git clean -nd` empty. Second `uninstall` → "no manifest found".
6. Repeat step 1 in a dir that **does** have a `package.json` → `.npmrc` now
   carries the registry line; everything else as above.

## Performance Considerations

Negligible — copy mode adds a recursive read/compare/write over a handful of
small text files per skill. No new dependencies.

## Migration Notes

No migration. A consumer that ran S-01/S-02/S-03 keeps roaming mode and its
dir-level manifest entries untouched. Copy mode is opt-in via `npx` in a
manifest-less repo or `--copy`. A manifest written by copy mode is read back by
the same-version `uninstall`; mixing modes across installs in one repo is
outside the MVP's intent but degrades safely (uninstall handles both entry
shapes).

## References

- Roadmap slice: `context/foundation/roadmap.md` § S-04 `standalone-copy-install`;
  OQ-4
- PRD: `context/foundation/prd.md` FR-005 (both modes; copy without a project
  manifest), US-02, § Guardrails, § NFR (idempotency, no secret in repo)
- Shape notes: `context/foundation/shape-notes.md` (`npx @scope/ai-toolkit
  install` copy mode "działa też bez `package.json`")
- Prior changes: `context/changes/consumer-install-symlink/plan.md` (S-01),
  `.../consumer-update-and-reconcile/plan.md` (S-02),
  `.../consumer-uninstall-clean/plan.md` (S-03) — the engine this extends
- Reference copy-mode shape:
  `.claude/config-templates/m5l4-github-packages-install.js.template`
- Current code: `src/consumer.ts` (`findConsumerRoot` `:27`), `src/install.ts`
  (`linkSkills` `:38`, `ensureNpmrc` `:163`, `pruneWithdrawn` `:219`,
  `writeManifest` `:285`, `runInstall` `:327`), `src/uninstall.ts` (`:102`),
  `src/cli.ts` (`:14`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Mode resolution + copy engine (skills, rules, manifest)

#### Automated

- [x] 1.1 Build passes: `npm run build` — 25605e2
- [x] 1.2 Type check passes: `npm run typecheck` — 25605e2
- [x] 1.3 Test suite passes, incl. the new copy-mode suite and every existing test unchanged: `npm test` — 25605e2
- [x] 1.4 `npm pack --dry-run --json` still lists only `dist/`, `skills/`, `rules/`, `bin/`, `README.md`, `package.json` — 25605e2

#### Manual

- [x] 1.5 Scratch dir with no `package.json`: `install --copy` creates a real `.claude/skills/code-review/SKILL.md`, a `CLAUDE.md` block, a per-file manifest, and no `.npmrc`; re-run leaves `git status` clean — 25605e2
- [x] 1.6 On Windows copy mode needs no Developer Mode / elevation — 25605e2

### Phase 2: Copy-aware uninstall + withdrawn-artifact prune

#### Automated

- [x] 2.1 Build passes: `npm run build` — b385c0e
- [x] 2.2 Type check passes: `npm run typecheck` — b385c0e
- [x] 2.3 Test suite passes, incl. the new copy-mode uninstall/prune tests and every existing test unchanged: `npm test` — b385c0e
- [x] 2.4 `npm pack --dry-run --json` allowlist unchanged — b385c0e

#### Manual

- [x] 2.5 Scratch repo with no `package.json`: `install --copy` + commit, then `uninstall` → `git status` clean, `git clean -nd` empty, `.claude/` gone — b385c0e
- [x] 2.6 A hand-written `CLAUDE.md` section above the block survives uninstall; `git diff` shows only the block removal — b385c0e

### Phase 3: Documentation + roadmap

#### Automated

- [x] 3.1 `npm run build && npm test` still green
- [x] 3.2 `npm pack --dry-run --json` allowlist unchanged

#### Manual

- [x] 3.3 README "Standalone copy install" section matches implemented behaviour; the `.npmrc`/`package.json` rule and "cwd is the target" caveat are unambiguous; S-05 scope boundary clear
- [x] 3.4 `## Status`, `## Layout`, `## Context` reflect S-04 implemented
