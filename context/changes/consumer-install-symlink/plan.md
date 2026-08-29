# Consumer install (symlink mode) — S-01 Implementation Plan

## Overview

Fill the real consumer-side reconcile logic into the `@10xpackages/ai-toolkit`
installer stub. When a consumer repo runs a standard dependency install
(`npm install`, which fires the package's `postinstall` hook), the installer:

1. **symlinks** each shipped skill directory into the consumer's
   `.claude/skills/<name>` (roaming mode — the artifacts travel with the
   `node_modules` dependency and follow it on `npm update`);
2. **injects** the team rules block into the consumer's root `CLAUDE.md` between a
   pair of sentinel markers, leaving everything outside the markers untouched;
3. **ensures** exactly the missing scope→registry mapping line in the consumer's
   project `.npmrc` (never rewriting existing registry entries), plus a
   credential line **only** when a credential env var is present;
4. **writes** an install manifest (`package`, `version`, `tool`, `files[]`) that
   update (S-02) and uninstall (S-03) read back.

This is the roadmap north star (S-01) and holds the highest-risk logic in the
MVP: sentinel merging, first-run idempotency, cross-platform symlinks, `.npmrc`
surgery, and the manifest contract three downstream slices consume.

## Current State Analysis

- **Skeleton is in place and green** (F-01, commits `ddaba39` / `9ead141`). The
  installer is a stub: `src/install.ts` exports `runInstall(): Promise<void>`,
  walks `__dirname` up to a `node_modules/` (honouring `process.env.PROJECT_ROOT`
  first for tests), and currently only logs a "not yet implemented" line. It
  never throws — an exception here must not fail a consumer's `npm install`.
- **Boundary contracts are frozen** in `src/manifest.ts:1-60`:
  `PACKAGE_NAME`, `PACKAGE_VERSION`, `SENTINEL_BEGIN` /
  `SENTINEL_END` (`<!-- BEGIN @10xpackages/ai-toolkit -->` /
  `<!-- END ... -->`), and `interface ToolkitManifest { package; version;
  tool: "claude-code"; installedAt; files: string[] }`. `test/manifest.test.ts`
  locks these — S-01 must not break them.
- **Wiring already exists**: `package.json#scripts.postinstall` =
  `node bin/ai-toolkit.js install`; `bin/ai-toolkit.js` fail-soft-`require`s
  `dist/cli.js`; `src/cli.ts` routes `install` → `runInstall`. `pretest` runs
  `npm run build`; `npm test` = `vitest run`.
- **Payload exists**: `skills/code-review/SKILL.md`, `rules/CLAUDE.md` (asserted
  non-empty and sentinel-free by `test/package-structure.test.ts`).
- **Reference implementation** (adapt, do not copy 1:1):
  `.claude/config-templates/m5l4-github-packages-install.js.template` —
  `findProjectRoot` walk-up (already ported), `copyDir` / `installSkills`
  (we symlink instead of copy), `applyRulesBlock` (sentinel insert/replace —
  reuse the string logic), `writeManifest` (shape matches, plus PRD FR-009
  `tool` field the skeleton already added).
  `.claude/config-templates/m5l4-github-packages-consumer.npmrc.template` — the
  single scope→registry line, no token.
- **PRD grounding**: FR-005 (standard dependency install path), FR-006 (`.npmrc`
  ensure-line + conditional credential, absent env var must not block), FR-007
  (each skill as its own entry in the AI-tool skills dir), FR-008 (rules block
  between sentinels, content outside untouched), FR-009 (manifest fields), plus
  the Guardrails: **idempotency** (run twice → zero diff), **no secret in repo**,
  **gentle coexistence** with the consumer's existing files. NFR pins the
  idempotency guarantee down to the manifest file's own bytes.
- **No `research.md` / `frame.md`** for this change — upstream grounding is
  `context/foundation/{roadmap.md,prd.md}` and the F-01 plan.

## Desired End State

`runInstall()` performs a real reconcile against a consumer root
(`PROJECT_ROOT` or the `node_modules` parent):

- Every top-level directory under the package's `skills/` appears as
  `.claude/skills/<name>` in the consumer root, as a **symlink** (POSIX) or
  **directory junction** (Windows) resolving to the package's copy in
  `node_modules`. A pre-existing real directory of the same name is a collision:
  warn and skip it (roadmap OQ-5 default), do not overwrite.
- The consumer's root `CLAUDE.md` contains the team rules block fenced by
  `SENTINEL_BEGIN` / `SENTINEL_END`. Content outside the fences is byte-identical
  to before. If the file was absent it is created containing only the block.
- The consumer's project `.npmrc` contains the line
  `@10xpackages:registry=https://npm.pkg.github.com` (appended only if absent;
  existing registry lines untouched). If `process.env.NODE_AUTH_TOKEN` is set at
  install time, `.npmrc` also contains
  `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` — the literal
  env-var reference, never the token value. If the env var is unset the line is
  absent and the install still completes.
- `<consumerRoot>/.claude/.ai-toolkit-manifest.json` is a valid `ToolkitManifest`
  with `files` listing every path the installer created or modified
  (skill symlinks, `CLAUDE.md`, `.npmrc`), consumer-root-relative, POSIX
  separators, sorted.
- **Idempotency**: a second `runInstall()` on an unchanged tree writes nothing —
  no duplicate rules block, no duplicate `.npmrc` line, and the manifest file
  (including `installedAt`) is left untouched because the recomputed manifest
  equals the stored one. `git status` after the second run is clean.

**Verification**: `npm test` (new install suite), `npm run typecheck`,
`npm run build`, `npm pack --dry-run` still excludes `src/`/`test/`/`context/`;
plus a manual real-install into a scratch consumer repo on Windows (folds in
OQ-4).

### Key Discoveries:

- `findConsumerRoot()` (`src/install.ts:14-24`) already implements the
  `PROJECT_ROOT` → walk-up-to-`node_modules` → `null` resolution. Reuse as-is;
  `null` stays a clean no-op (toolkit checkout / S-04 territory).
- Payload path resolves identically from `dist/` and from `src/` under Vitest:
  `path.join(__dirname, "..", "skills")` → `<pkg>/skills` in both layouts
  (`src/` and `skills/` are siblings; `dist/` and `skills/` are siblings).
- `applyRulesBlock` from the template is idempotent by construction: the
  "append" branch produces `original.trimEnd() + "\n\n" + block + "\n"`, and the
  "replace" branch on that output reproduces the same bytes. Reuse its logic
  verbatim; add only a malformed-state guard.
- Windows: `fs.symlinkSync(target, path, "junction")` creates a directory
  junction that needs **no** Developer Mode / admin rights and requires an
  absolute target (we have one). This sidesteps most of OQ-4; the residual
  Windows check is the manual verification step.
- Doing the `.npmrc` edit in Node (`fs`) rather than `echo`/bash removes the
  shell dependency OQ-4 flagged for the credential line — cross-platform for
  free.
- `test/manifest.test.ts` builds a literal `ToolkitManifest` with exactly five
  fields — the interface is **not** to be extended. Per-path uninstall semantics
  (which S-03 consumes) live in the plan, not the type.

## What We're NOT Doing

- **No update / reconcile-on-change / withdrawn-artifact removal** — that is S-02
  (`consumer-update-and-reconcile`). S-01 writes the manifest; it does not diff
  an old one against a new one.
- **No uninstall logic** — S-03. `src/uninstall.ts` stays a stub. This plan only
  documents the `files`-list semantics S-03 will rely on.
- **No copy mode / `npx` one-shot install / support for repos without a project
  manifest** — S-04 (`standalone-copy-install`). `findConsumerRoot()` returning
  `null` stays a no-op.
- **No rich unsafe-state handling** — S-05 (`installer-safe-refusals`). S-01 does
  the minimum not to *corrupt*: on a malformed sentinel state (exactly one
  marker, or `END` before `BEGIN`) it logs a clear warning and skips the rules
  step. The hard abort with a precise file/line pointer (FR-012) and the
  sentinel-injection guard for consumer-crafted rules content (FR-014) are S-05.
  Full name-collision policy beyond "warn and skip" (FR / OQ-5) is also S-05.
- **No CI workflow / consumer-side auth flow design** — S-06 / S-07. S-01 only
  writes the `${NODE_AUTH_TOKEN}` reference line when the env var is already set.
- **No multi-tool profiles**, no `prompts/` or `config-templates/` payload — PRD
  Non-Goals.
- **No change to the `ToolkitManifest` interface or the sentinel constants.**

## Implementation Approach

Rewrite `src/install.ts` so `runInstall()` runs an ordered reconcile and writes
the manifest last. Structure it as small, individually testable functions:

```
runInstall()
  ├─ findConsumerRoot()            (exists — reuse)
  ├─ linkSkills(root)      -> string[]   Phase 1
  ├─ applyRulesBlock(root) -> string[]   Phase 2   (extends files[])
  ├─ ensureNpmrc(root)     -> string[]   Phase 3   (extends files[])
  └─ writeManifest(root, files)          Phase 1 skeleton, unchanged after
```

Each phase adds one step and its paths to `files[]`, updates the manifest-write
call site, and lands its own tests with the suite green. The whole body stays
wrapped so a failure downgrades to `console.warn` and never breaks
`npm install` (unchanged contract); explicit `ai-toolkit install` surfaces the
same warnings.

`vitest` bump to v4 (F-01 impl-review F1 follow-up) is **in scope for Phase 1**
since Phase 1 first touches the test harness. Land it as its **own commit at the
start of Phase 1**, before the `src/install.ts` rewrite: `npm audit fix --force`
(two-major `vitest` jump — check `vitest.config.ts` / `vitest/config` import
still valid), confirm the existing suite passes, commit the lockfile + any config
tweak alone so a harness regression stays bisectable. The Phase 1 feature commit
lands on top.

## Critical Implementation Details

- **Manifest idempotency (NFR).** `installedAt` is a fresh timestamp on every
  call, so unconditionally rewriting the manifest would break the "second run →
  zero diff" NFR. Compute the candidate manifest (`package`, `version`, `tool`,
  sorted `files`), read the existing file if present, and **skip the write
  entirely** when the two are equal ignoring `installedAt`. Only write — and only
  then bump `installedAt` — when something actually changed.
- **Symlink type & target.** Target is the absolute path to the payload skill dir
  under `node_modules` (`path.join(__dirname, "..", "skills", name)`). Type is
  `process.platform === "win32" ? "junction" : "dir"`. Detect an existing entry
  we own with `fs.readlinkSync`: treat **any** throw (Windows may raise `EINVAL`,
  `UNKNOWN`, or `EPERM` on a real dir) as "not our managed link" — then branch on
  `fs.existsSync`: exists → collision (warn + skip, omit from `files`), absent →
  create. When `readlinkSync` succeeds, resolve with `fs.realpathSync` inside its
  own try/catch: resolves to the current target → leave as-is; resolves elsewhere
  **or throws** (broken link, missing target) → `rmSync` + recreate.
- **Rules block append vs replace.** Reuse the template's `applyRulesBlock`
  string logic (`indexOf(BEGIN)` / `indexOf(END)`; both present and `END > BEGIN`
  → splice; else `existing.trimEnd() + "\n\n" + block + "\n"`). Guard first: if
  exactly one marker is present, or `END` precedes `BEGIN`, do not write — warn
  naming `CLAUDE.md` and the missing/!ordered marker, skip the step, and do not
  push `CLAUDE.md` into `files`.
- **`.npmrc` ensure-line.** Read the file (empty string if absent), split on
  `\n`, append a line only if no existing line `=== ` it (trimmed compare).
  Never parse-and-rewrite existing entries. The credential line is added by the
  same ensure-line helper, gated on `process.env.NODE_AUTH_TOKEN` being a
  non-empty string; the value written is the literal
  `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` (npm expands it at read
  time — no secret persisted).

## Phase 1: Skill symlink layout + manifest write

### Overview

Replace the install stub body with real consumer-root resolution, skill-directory
symlinking (idempotent, collision-skipping), and the change-detecting manifest
write. After this phase `ai-toolkit install` lays out skills and records them.

### Changes Required:

#### 1. Installer core — skill linking + manifest

**File**: `src/install.ts`

**Intent**: Turn `runInstall()` into a real reconcile that (a) resolves the
consumer root via the existing `findConsumerRoot()`, (b) for each top-level dir
under the package payload `skills/`, creates `.claude/skills/<name>` in the
consumer root as a symlink/junction to the payload dir, skipping with a warning
when a non-link entry of that name already exists, and (c) writes the
`ToolkitManifest` to `.claude/.ai-toolkit-manifest.json`, but only when the
recomputed manifest differs (ignoring `installedAt`) from any existing one. Body
stays wrapped so nothing thrown escapes as an `npm install` failure.

**Contract**:
- `runInstall(): Promise<void>` — signature unchanged.
- **Early return on null root.** `runInstall()` must call `findConsumerRoot()`
  first and, when it returns `null` (toolkit checkout / no `PROJECT_ROOT` / not
  under `node_modules`), print the existing one-line notice and return before any
  `linkSkills` / `applyRulesBlock` / `ensureNpmrc` / `writeManifest` call. This
  preserves the quiet no-op on local `npm install` in this repo.
- New non-exported helpers, or exported for direct unit test as the suite needs:
  `linkSkills(consumerRoot: string): string[]` returns the consumer-root-relative
  POSIX paths of the links it created/kept; `writeManifest(consumerRoot: string,
  files: string[]): void` performs the equality-check-then-write.
- Payload skills dir: `path.join(__dirname, "..", "skills")`. If absent, no-op
  (published tarball always ships it; guard is for a broken local state).
- Symlink: `fs.symlinkSync(absTarget, linkPath, platform === "win32" ?
  "junction" : "dir")`; parent `.claude/skills/` created `recursive`.
- Manifest object: `{ package: PACKAGE_NAME, version: PACKAGE_VERSION,
  tool: "claude-code", installedAt: new Date().toISOString(),
  files: [...].sort() }`, written as `JSON.stringify(m, null, 2) + "\n"`.
- Equality check ignores `installedAt`; on equal, return without writing.

#### 2. Install test suite — skills + manifest

**File**: `test/install.test.ts` (new)

**Intent**: Lock the Phase 1 behaviour against a temp consumer root.

**Contract**: Uses `mkdtempSync` + `process.env.PROJECT_ROOT`. Cases:
fresh install creates `.claude/skills/code-review` resolving (`realpathSync`) to
the payload; manifest written with all five fields, `tool: "claude-code"`,
`files` sorted and containing the skill link path; **idempotent re-run** leaves
the skill link and the manifest file mtime + `installedAt` unchanged;
a pre-existing real `.claude/skills/code-review/` directory is left intact, a
warning is emitted, and it is absent from `files`. Restores `PROJECT_ROOT` and
mocks `console` in `afterEach` (mirror `test/entrypoints.test.ts`).

#### 3. Toolchain advisory follow-up (separate commit, first in Phase 1)

**File**: `package.json`, `package-lock.json`, possibly `vitest.config.ts`

**Intent**: Clear the transitive `vitest`/esbuild dev-server advisories flagged in
the F-01 impl-review (F1) now that Phase 1 first touches the harness. Land this
**before** the `src/install.ts` rewrite as its own commit so a harness regression
from the two-major `vitest` jump is bisectable.

**Contract**: `npm audit fix --force` (accepts the `vitest` v2→v4 major bump).
Verify `vitest/config` import and `test.include` in `vitest.config.ts` still
valid under v4; adjust if the config API changed. The **existing** suite
(`npm test`) must still pass unchanged. Commit lockfile + `package.json` + any
config tweak alone.

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Type check passes: `npm run typecheck`
- Test suite passes (incl. new `test/install.test.ts`): `npm test`
- `npm audit` reports 0 advisories (or documents any residual as
  dev-only/unfixable)
- `npm pack --dry-run` still lists only `dist/`, `skills/`, `rules/`, `bin/`,
  `README.md`, `package.json`

#### Manual Verification:

- In a scratch consumer repo, `PROJECT_ROOT=<dir> node bin/ai-toolkit.js
  install` creates `.claude/skills/code-review` as a link/junction resolving
  into the package; re-running leaves `git status` clean
- On Windows, the junction is created without Developer Mode / elevation

**Implementation Note**: After Phase 1 automated verification passes, pause for
manual confirmation before Phase 2.

---

## Phase 2: Team rules block injection

### Overview

Insert/replace the sentinel-fenced team rules block in the consumer's root
`CLAUDE.md`, preserving all content outside the fences, idempotently, with a
minimal malformed-state guard.

### Changes Required:

#### 1. Rules block step

**File**: `src/install.ts`

**Intent**: Add `applyRulesBlock(consumerRoot): string[]` and call it from
`runInstall()` between `linkSkills` and `writeManifest`. Reads the payload
`rules/CLAUDE.md`, builds `${SENTINEL_BEGIN}\n${teamRules.trim()}\n${SENTINEL_END}`,
and writes it into `<consumerRoot>/CLAUDE.md`: splice between existing well-formed
markers, else append after the existing content, else create the file with just
the block. Returns `["CLAUDE.md"]` when it wrote or would keep an owned block,
`[]` when it skipped on a malformed state.

**Contract**:
- Payload rules file: `path.join(__dirname, "..", "rules", "CLAUDE.md")`.
- Marker search: `content.indexOf(SENTINEL_BEGIN)` / `indexOf(SENTINEL_END)`.
  Both `>= 0` and `END > BEGIN` → `slice(0, begin) + block + slice(endIdx +
  SENTINEL_END.length)`. Neither present → `content.trimEnd() + "\n\n" + block +
  "\n"` (or just `block + "\n"` if the file is absent/empty).
- Malformed (exactly one marker, or `END` before `BEGIN`) → `console.warn`
  naming the file and the problem, return `[]`, write nothing.
- Idempotent: re-running the append path then hitting the replace path must
  reproduce identical bytes.
- `runInstall()` concatenates this step's paths into `files[]` before
  `writeManifest`.

#### 2. Rules block tests

**File**: `test/install.test.ts`

**Intent**: Cover the three write paths, out-of-band preservation, idempotency,
and the malformed guard.

**Contract**: Added cases — no `CLAUDE.md` → created with only the block;
pre-seeded `# My rules\ncustom\n` → block appended, `custom` still present, and a
second run produces byte-identical file; pre-seeded with an old block between
markers → inner content replaced, text before/after markers intact; pre-seeded
with only `SENTINEL_BEGIN` → warning, file unchanged, no second block, `CLAUDE.md`
absent from manifest `files`.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npm run typecheck`
- Test suite passes: `npm test`
- Grep check: after a two-run install in a temp dir, `CLAUDE.md` contains
  exactly one `SENTINEL_BEGIN` and one `SENTINEL_END`

#### Manual Verification:

- In a scratch consumer repo with a hand-written `CLAUDE.md`, install then
  re-install: developer's own sections are untouched and the block appears
  once; `git diff` on the second run is empty

**Implementation Note**: After Phase 2 automated verification passes, pause for
manual confirmation before Phase 3.

---

## Phase 3: Registry `.npmrc` line + conditional credential

### Overview

Ensure only the missing scope→registry mapping line in the consumer's project
`.npmrc`, plus a credential-reference line gated on an env var, with no secret
ever written. Update the README with consumer setup and the OQ-6 manifest-policy
recommendation.

### Changes Required:

#### 1. `.npmrc` ensure-line step

**File**: `src/install.ts`

**Intent**: Add `ensureNpmrc(consumerRoot): string[]` and call it from
`runInstall()` before `writeManifest`. Appends
`@10xpackages:registry=https://npm.pkg.github.com` to `<consumerRoot>/.npmrc`
only if no line already equals it; if `process.env.NODE_AUTH_TOKEN` is a
non-empty string, also ensures
`//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` (literal, unexpanded).
Never edits or reorders existing lines. Returns `[".npmrc"]` if the file exists
or was created by this step, else `[]`.

**Contract**:
- Read `<root>/.npmrc` as `""` if absent; work on `text.split("\n")`.
- `ensureLine(lines, line)`: push `line` iff `!lines.some(l => l.trim() === line)`.
- Write back only if the array changed; join with `"\n"`, ensure a single
  trailing newline.
- Credential line is gated **only** on `process.env.NODE_AUTH_TOKEN`; absence is
  not an error and does not block (FR-006).
- Push `.npmrc` into `runInstall()`'s `files[]` before `writeManifest`.

#### 2. `.npmrc` tests

**File**: `test/install.test.ts`

**Intent**: Cover ensure-line semantics, existing-entry preservation, the
conditional credential, and the no-secret guarantee.

**Contract**: Added cases — no `.npmrc` → created with the mapping line;
pre-seeded with an unrelated `@other:registry=...` line → our line appended, the
other line byte-identical; second run → no duplicate line;
`NODE_AUTH_TOKEN` set (to a sentinel value) → `.npmrc` contains the literal
`${NODE_AUTH_TOKEN}` reference and **not** the sentinel value; `NODE_AUTH_TOKEN`
unset → no `_authToken` line and `runInstall()` still resolves.

#### 3. README consumer setup + manifest policy

**File**: `README.md`

**Intent**: Replace the "preview" framing with the real S-01 install flow: what
lands where (`.claude/skills/<name>` symlinks, `CLAUDE.md` block, `.npmrc` line,
`.claude/.ai-toolkit-manifest.json`), the `NODE_AUTH_TOKEN` behaviour, the OQ-6
recommendation on the manifest, and a gitignore note for the managed skill links.

**Contract**: Prose only.
- OQ-6: recommend committing `.claude/.ai-toolkit-manifest.json` so update /
  uninstall are reproducible across the team.
- Symlink-mode artifacts: recommend the consumer **gitignore the managed skill
  entries** under `.claude/skills/` — in roaming mode they are regenerated from
  `node_modules` on every install, and a committed symlink is fragile across
  platforms (Windows without `core.symlinks` stores it as a text file holding the
  target path). The `CLAUDE.md` block and the `.npmrc` line are real content and
  are committed normally.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npm run typecheck`
- Test suite passes: `npm test`
- Build passes and `npm pack --dry-run` unchanged: `npm run build && npm pack --dry-run`
- No-secret assertion in the suite passes (token value absent from `.npmrc`)

#### Manual Verification:

- Real end-to-end on Windows: `npm pack`, install the tarball into a scratch
  consumer repo (`npm install <tgz>`), confirm skills junction + `CLAUDE.md`
  block + `.npmrc` mapping line + manifest; re-run `npm install` → tree clean
- With `NODE_AUTH_TOKEN` exported, the `.npmrc` credential line is the
  `${NODE_AUTH_TOKEN}` reference, and `git diff` shows no literal token
- README consumer-setup section reads correctly and the OQ-6 recommendation
  is unambiguous

**Implementation Note**: After Phase 3 automated verification passes and manual
confirmation, S-01 is complete — S-02 / S-03 / S-04 / S-05 are unblocked.

---

## Testing Strategy

### Unit / integration tests (`test/install.test.ts`, Vitest, node env)

All run against a `mkdtempSync` consumer root via `process.env.PROJECT_ROOT`,
`console` mocked, `PROJECT_ROOT` restored in `afterEach`.

- **Skills**: link created and resolves to payload; idempotent re-run; real-dir
  collision → skip + warn + absent from `files`.
- **Manifest**: five fields, `tool: "claude-code"`, `files` sorted; re-run leaves
  file + `installedAt` untouched (mtime unchanged).
- **Rules**: create / append / replace paths; out-of-band content preserved;
  byte-identical second run; malformed single-marker → warn + skip + no
  corruption.
- **`.npmrc`**: create; ensure-line with unrelated entry preserved; no duplicate
  on re-run; conditional credential line; token value never written.

### Manual testing steps

1. `npm pack` → install the tarball into a scratch repo with its own
   `package.json` and a hand-written `CLAUDE.md`.
2. Confirm `.claude/skills/code-review` (junction on Windows), `CLAUDE.md` block
   between markers with the developer's sections intact, `.npmrc` mapping line,
   `.claude/.ai-toolkit-manifest.json` well-formed.
3. Re-run `npm install` → `git status` clean (idempotency + NFR).
4. Export `NODE_AUTH_TOKEN`, re-install → `_authToken` reference line present,
   no literal token in `git diff`.
5. Remove a marker from `CLAUDE.md`, re-install → clear warning, no second block.

## Performance Considerations

None. A handful of `fs` calls per install; no hot path.

## Migration Notes

The `postinstall` hook already points at `install`; after this change a real
reconcile runs on `npm install` in a consumer repo. In **this** repo,
`findConsumerRoot()` returns `null` (not under `node_modules`, no `PROJECT_ROOT`)
so local `npm install` stays a quiet no-op — no migration needed. The
`.claude/config-templates/` reference files are untouched.

## References

- Roadmap: `context/foundation/roadmap.md` → S-01 `consumer-install-symlink`
  (north star)
- PRD: `context/foundation/prd.md` → US-02, FR-005–FR-009, Guardrails, NFR
- Skeleton plan: `context/changes/package-skeleton/plan.md`
- Frozen contracts: `src/manifest.ts`
- Reference installer: `.claude/config-templates/m5l4-github-packages-install.js.template`
- Reference consumer `.npmrc`: `.claude/config-templates/m5l4-github-packages-consumer.npmrc.template`
- Existing stub + test pattern: `src/install.ts`, `test/entrypoints.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Skill symlink layout + manifest write

#### Automated

- [ ] 1.1 Build passes: `npm run build`
- [ ] 1.2 Type check passes: `npm run typecheck`
- [ ] 1.3 Test suite passes (incl. new `test/install.test.ts`): `npm test`
- [ ] 1.4 `npm audit` reports 0 advisories (or documents residual as dev-only/unfixable)
- [ ] 1.5 `npm pack --dry-run` still lists only `dist/`, `skills/`, `rules/`, `bin/`, `README.md`, `package.json`

#### Manual

- [ ] 1.6 Scratch-repo `PROJECT_ROOT=<dir> node bin/ai-toolkit.js install` creates the skill link resolving into the package; re-run leaves `git status` clean
- [ ] 1.7 On Windows the junction is created without Developer Mode / elevation

### Phase 2: Team rules block injection

#### Automated

- [ ] 2.1 Type check passes: `npm run typecheck`
- [ ] 2.2 Test suite passes: `npm test`
- [ ] 2.3 Grep check: after a two-run install, `CLAUDE.md` has exactly one `SENTINEL_BEGIN` and one `SENTINEL_END`

#### Manual

- [ ] 2.4 Scratch repo with a hand-written `CLAUDE.md`: install then re-install leaves the developer's sections untouched, block appears once, second-run `git diff` empty

### Phase 3: Registry `.npmrc` line + conditional credential

#### Automated

- [ ] 3.1 Type check passes: `npm run typecheck`
- [ ] 3.2 Test suite passes: `npm test`
- [ ] 3.3 Build passes and `npm pack --dry-run` unchanged: `npm run build && npm pack --dry-run`
- [ ] 3.4 No-secret assertion passes (token value absent from `.npmrc`)

#### Manual

- [ ] 3.5 Real end-to-end on Windows: tarball install into scratch repo → skills junction + `CLAUDE.md` block + `.npmrc` line + manifest; re-run `npm install` → tree clean
- [ ] 3.6 With `NODE_AUTH_TOKEN` exported, `.npmrc` credential line is the `${NODE_AUTH_TOKEN}` reference and `git diff` shows no literal token
- [ ] 3.7 README consumer-setup section reads correctly and the OQ-6 recommendation is unambiguous
