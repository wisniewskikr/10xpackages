# Consumer clean uninstall (S-03) Implementation Plan

## Overview

Turn `src/uninstall.ts` from a stub into a real **manifest-driven uninstaller**:
a consumer runs `npx ai-toolkit uninstall` and every file the package installed
is removed — skill links, the sentinel-fenced team-rules block, the
registry-mapping (and credential) line in `.npmrc`, and the install manifest
itself — with the developer's own content left byte-for-byte intact and version
control showing **no trace** of the package afterwards.

S-01 built the forward reconcile and froze the `ToolkitManifest` contract; S-02
added the withdrawn-artifact prune and CRLF-agnostic block/line editing. This
change reuses both: uninstall is the inverse of the same operations, restricted
to exactly the paths the manifest's `files[]` records.

## Current State Analysis

- **`src/uninstall.ts`** (`:10`): `runUninstall()` is a stub — logs a
  "not yet implemented" line, never throws. Same no-throw contract as
  `runInstall()`.
- **`src/cli.ts`** (`:6`): `USAGE` text calls both `install` and `uninstall`
  skeleton stubs; the dispatch already routes `uninstall` → `runUninstall()`.
- **`src/install.ts`** holds the primitives uninstall needs, all currently
  module-private:
  - `findConsumerRoot()` (`:24`) — walk up to the enclosing `node_modules/`;
    `PROJECT_ROOT` env override for tests; `null` when run from a toolkit
    checkout.
  - `MANIFEST_RELPATH` (`:13`) = `.claude/.ai-toolkit-manifest.json`,
    `SKILLS_RELDIR` (`:15`) = `.claude/skills`.
  - `toManifestPath()` (`:41`), `stripCr()` (`:46`), `toCrlf()` (`:51`) —
    POSIX-path + line-ending helpers.
  - The ownership probe pattern (`fs.readlinkSync` succeeds ⇒ it is a link we
    may remove; throws ⇒ real entry, leave it) — used in both `linkSkills`
    (`:84`) and `pruneWithdrawn` (`:282`).
- **`src/manifest.ts`**: `ToolkitManifest = { package, version, tool,
  installedAt, files[] }`. `files[]` is sorted, POSIX, consumer-root-relative.
  Frozen — `test/manifest.test.ts` locks the five-field literal. Uninstall
  **reads** it, never changes its shape.
- **`applyRulesBlock()`** (`src/install.ts:143`) is the exact inverse of what
  uninstall must do to `CLAUDE.md`: it splices a block **between**
  `SENTINEL_BEGIN` / `SENTINEL_END`, preserves everything outside, treats
  "exactly one marker / END before BEGIN" as malformed → warn + skip, and
  writes back with the file's own EOL only when content actually changed.
- **`ensureNpmrc()`** (`src/install.ts:193`): appends `@10xpackages:registry=…`
  always, and `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` (literal,
  never the token value) **only** when `NODE_AUTH_TOKEN` is set. Line compare is
  trimmed + CR-insensitive. These two exact strings are what uninstall removes.
- **`.claude/config-templates/m5l4-github-packages-uninstall.js.template`**: the
  reference shape — `for (relPath of manifest.files) { if (relPath==="CLAUDE.md")
  continue; fs.rmSync(...) }`, then `removeRulesBlock()` (drop BEGIN…END, collapse
  `\n{3,}`→`\n\n`), then delete the manifest. This plan adapts it and adds:
  ownership-checked link removal, `.npmrc` line surgery, empty-file/dir cleanup,
  CRLF-agnostic block removal, and the malformed-state postures.
- **`test/entrypoints.test.ts`** (`:36`): asserts `runUninstall()` resolves
  without throwing — must stay green.
- **`test/install.test.ts`**: imports only `runInstall` + manifest types, never
  `install.ts` internals — so extracting helpers to a new module does not touch
  it.

### Key Discoveries:

- **Uninstall = the manifest's `files[]`, nothing walked or guessed.** Every
  entry is one of three shapes: `.claude/skills/<name>` (a link), `CLAUDE.md`
  (a block inside a shared file), `.npmrc` (two known lines inside a shared
  file). No other shape is possible in the MVP payload.
- **Shared content is edited, not deleted.** `CLAUDE.md` and `.npmrc` may hold
  the consumer's own content; uninstall removes only the package's fenced block
  / its two known lines, then deletes the file **only if it is left empty**.
- **The `node_modules` walk in `findConsumerRoot()` must not be duplicated** —
  drift there breaks one entrypoint silently. It moves to a shared module both
  `install.ts` and `uninstall.ts` import.
- **Malformed manifest → do nothing.** The rich "list candidate files for
  manual removal" UX is FR-013 / S-05 (nice-to-have, may be cut). For S-03 an
  unreadable or unparseable manifest means uninstall warns and leaves the tree
  untouched — never delete from state it cannot read.
- **`preuninstall` hook (OQ-7) is resolved as "no hook".** npm does not run a
  dependency's lifecycle scripts when that dependency is removed; a
  `preuninstall`/`postuninstall` only fires for the top-level package on
  `npm uninstall <self>`, which never happens for `@10xpackages/ai-toolkit` as
  a dependency. The PRD deliberately makes uninstall an explicit,
  consciously-invoked command ("konsument musi ją odpalić świadomie"). Adding a
  hook that cannot fire would be dead config.

## Desired End State

`runUninstall()` performs, in order, never throwing:

1. `findConsumerRoot()` → `null` ⇒ log "running from a toolkit checkout, nothing
   to uninstall", return.
2. Read `.claude/.ai-toolkit-manifest.json`. Absent ⇒ log "no manifest found,
   nothing to uninstall", return. Present but unparseable / missing `files[]` ⇒
   `console.warn` "manifest unreadable — leaving all files in place", return.
3. For each path in `manifest.files`:
   - `.claude/skills/<name>` — ownership-probe; a link ⇒ `fs.rmSync(…, {recursive,
     force})`; a real directory/file ⇒ `console.warn` "not managed by this
     package — left in place".
   - `CLAUDE.md` — strip the `SENTINEL_BEGIN … SENTINEL_END` block
     (CRLF-agnostic, EOL preserved on write, surrounding text byte-identical,
     `\n{3,}`→`\n\n` at the seam). Exactly one marker / END-before-BEGIN ⇒
     `console.warn` + skip the file. If the result is empty / whitespace-only ⇒
     delete `CLAUDE.md`.
   - `.npmrc` — remove any line equal (trimmed, CR-insensitive) to the registry
     line or the `${NODE_AUTH_TOKEN}` credential line; leave every other line and
     the file's EOL untouched; rewrite only if a line was removed. If the result
     is empty ⇒ delete `.npmrc`.
   - Any other path ⇒ `console.warn` "unexpected manifest entry — left in place".
4. `rmdir` `.claude/skills/` if now empty, then `.claude/` if now empty
   (non-recursive, guarded).
5. Delete the manifest file itself (last, so a crash mid-run is resumable).
6. Log "uninstalled N file(s)".

**Verification:** in a scratch consumer repo — `ai-toolkit install`, commit;
then `ai-toolkit uninstall` → `git status` is clean (every added path gone, the
manifest gone, hand-written `CLAUDE.md` / `.npmrc` content unchanged); a second
`ai-toolkit uninstall` prints "no manifest found" and exits 0; the same holds in
a repo whose `CLAUDE.md` / `.npmrc` use CRLF endings.

## What We're NOT Doing

- **Rich corrupted-manifest UX** (FR-013 / S-05) — enumerating candidate files
  for manual deletion, file/line pointers on a malformed block. Here a
  malformed manifest or block just warns and leaves things in place.
- **Sentinel-injection guard / hard abort** (FR-012 / FR-014 / S-05).
- **A `preuninstall` / `postuninstall` npm hook** (OQ-7 — resolved "no hook",
  see Key Discoveries). Uninstall stays an explicit `npx ai-toolkit uninstall`.
- **A `--force` / "delete anyway" flag** for the malformed-manifest path.
- **Copy / `npx` / manifest-less repos** (S-04).
- **Any change to `ToolkitManifest` or the sentinel constants**
  (`src/manifest.ts` frozen; `test/manifest.test.ts` locks it).
- **Removing `node_modules/@10xpackages/ai-toolkit` or touching
  `package.json` / `package-lock.json`** — that is the package manager's job;
  `ai-toolkit uninstall` only reverses what `ai-toolkit install` wrote into the
  project tree.
- **Reordering or reformatting untouched `.npmrc` lines / `CLAUDE.md`
  content** — only the package's own lines / block are removed.

## Implementation Approach

Three commits, in the S-01/S-02 rhythm:

1. **Extract the shared consumer primitives** into `src/consumer.ts`
   (`findConsumerRoot`, `MANIFEST_RELPATH`, `SKILLS_RELDIR`, `toManifestPath`,
   `stripCr`, `toCrlf`). `install.ts` re-imports them; behaviour and all
   existing tests are unchanged. This is a pure refactor so the uninstall diff
   in Phase 2 is small and the `node_modules` walk has one owner.
2. **Implement `runUninstall()`** in `src/uninstall.ts` against those helpers +
   `applyRulesBlock`'s inverse for the block, plus a local `removeNpmrcLines`.
   Update `src/cli.ts` `USAGE`. New `test/uninstall.test.ts`.
3. **Document** — README `### Consumer uninstall` section + `## Status` /
   `## Layout` / `## Context` refresh; roadmap S-03 → `in-progress`.

`removeRulesBlock` (CRLF-agnostic) is the mirror of `applyRulesBlock`: operate
on `stripCr(existing)`, find `SENTINEL_BEGIN` / `SENTINEL_END`, apply the same
malformed-marker test, cut `[begin, end+END.length)`, `trimEnd` the head slice
and collapse a `\n{3,}` seam to `\n\n`, restore `\r\n` if the original had it.

## Critical Implementation Details

- **Manifest deleted last.** If the run is interrupted after removing some files
  but before the manifest write, re-running uninstall still has an accurate
  `files[]` to finish from. Deleting it first would strand any not-yet-removed
  files with no record.
- **Ownership probe is the S-02 pattern verbatim**: `fs.readlinkSync(abs)`
  succeeds (even for a broken link) ⇒ ours to `rmSync`; throws ⇒ a real
  directory/file the consumer put there ⇒ warn + leave. Never `rmSync` a path
  that is not a link.
- **`.npmrc` surgery is line-exact, never a parse.** Match only lines whose
  CR-stripped `trim()` equals `@10xpackages:registry=https://npm.pkg.github.com`
  or `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` (the literal npm
  reference, present regardless of whether `NODE_AUTH_TOKEN` is set now). All
  other lines pass through in place; EOL is the file's own.
- **Empty-means-delete, non-empty-means-keep.** After block/line removal, a file
  that is `""` or whitespace-only is deleted (install created it, so uninstall
  removes it); a file with any remaining real content is kept and only rewritten
  if it actually changed — so an untouched CRLF file produces no diff.
- **Directory cleanup is guarded and shallow.** `fs.rmdirSync` only when
  `fs.readdirSync(dir).length === 0`; `.claude/skills/` first, then `.claude/`.
  A `.claude/` that still holds the consumer's `settings.json` etc. is left.

## Phase 1: Extract shared consumer-path & EOL helpers

### Overview

Move the primitives `uninstall.ts` needs out of `install.ts` into a new
`src/consumer.ts`, with `install.ts` importing them back. No behaviour change.

### Changes Required:

#### 1. New shared module

**File**: `src/consumer.ts`

**Intent**: Own the consumer-root discovery and the path / line-ending helpers
that both entrypoints use, so the `node_modules` walk and the CRLF logic have a
single definition.

**Contract**: exports, moved verbatim from `src/install.ts` (same signatures,
same behaviour):
- `const MANIFEST_RELPATH: string` — `.claude/.ai-toolkit-manifest.json`
- `const SKILLS_RELDIR: string` — `.claude/skills`
- `function findConsumerRoot(): string | null`
- `function toManifestPath(consumerRoot: string, absPath: string): string`
- `function stripCr(text: string): string`
- `function toCrlf(text: string): string`

#### 2. Installer re-imports

**File**: `src/install.ts`

**Intent**: Delete the moved definitions; import them from `./consumer`. Every
call site and the observable behaviour stay identical.

**Contract**: `import { MANIFEST_RELPATH, SKILLS_RELDIR, findConsumerRoot,
toManifestPath, stripCr, toCrlf } from "./consumer";` — remove the corresponding
`const` / `function` declarations. No other edits.

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Type check passes: `npm run typecheck`
- Full test suite passes unchanged: `npm test`
- `npm pack --dry-run --json` still lists only `dist/`, `skills/`, `rules/`,
  `bin/`, `README.md`, `package.json`

#### Manual Verification:

- `git diff` shows only a move (lines leave `install.ts`, appear in
  `consumer.ts`) plus one new import line — no logic change

**Implementation Note**: After this phase and all automated verification passes,
pause for manual confirmation before Phase 2. Under the `/goal`
human-out-of-loop directive the implementer performs the check in-session and
records it.

---

## Phase 2: Manifest-driven uninstall core + CLI

### Overview

Implement `runUninstall()` for real, update the CLI usage text, and cover it
with `test/uninstall.test.ts`.

### Changes Required:

#### 1. Uninstaller core

**File**: `src/uninstall.ts`

**Intent**: Read the install manifest and reverse exactly what it records —
remove owned skill links, strip the sentinel-fenced rules block from
`CLAUDE.md`, remove the two known `.npmrc` lines, delete any file left empty,
clean up emptied `.claude/skills/` and `.claude/`, then delete the manifest.
Never throw; failures downgrade to `console.warn`.

**Contract**:
- `export async function runUninstall(): Promise<void>` — try/catch wrapper,
  same shape as `runInstall`.
- `findConsumerRoot()` `null` ⇒ `console.log` "running from a toolkit checkout,
  nothing to uninstall", return.
- Manifest absent ⇒ `console.log` "no manifest found, nothing to uninstall",
  return. `JSON.parse` throws, or `files` is not an array ⇒ `console.warn`
  "${PACKAGE_NAME}: manifest unreadable — leaving all files in place", return.
- Per-entry dispatch on the manifest path string:
  - starts with `.claude/skills/` ⇒ ownership-probe (`fs.readlinkSync`); link ⇒
    `fs.rmSync(abs, { recursive: true, force: true })` and count it; real entry
    ⇒ `console.warn "… not managed by this package — left in place"`.
  - `=== "CLAUDE.md"` ⇒ `removeRulesBlock` (below); on malformed markers
    `console.warn` + skip; on empty result `fs.rmSync(path, { force: true })`;
    else write back only if changed. Count it when the block was present.
  - `=== ".npmrc"` ⇒ `removeNpmrcLines` (below); empty result ⇒ delete; else
    rewrite only if a line was removed. Count it when a line was removed.
  - anything else ⇒ `console.warn "unexpected manifest entry <path> — left in
    place"`.
- Local `function removeRulesBlock(raw: string): string | null` — CRLF-agnostic
  inverse of `applyRulesBlock`: work on `stripCr(raw)`, locate `SENTINEL_BEGIN` /
  `SENTINEL_END`; `(begin === -1) !== (end === -1)` or `end < begin` ⇒ return
  `null` (caller warns + skips); else cut `[begin, end + SENTINEL_END.length)`,
  `trimEnd()` the head, collapse `/\n{3,}/g` → `\n\n` at the seam, re-add a
  trailing `\n` if any content remains; restore `\r\n` via `toCrlf` when
  `/\r\n/.test(raw)`.
- Local `function removeNpmrcLines(raw: string): string` — split `stripCr(raw)`
  on `\n`, drop lines whose `trim()` equals `REGISTRY_LINE` or `AUTH_LINE`
  (constants derived exactly as in `ensureNpmrc`), re-join with the detected EOL;
  a fully-emptied file returns `""`.
- After the loop: `fs.rmdirSync(SKILLS_RELDIR)` if it exists and
  `fs.readdirSync` is empty; then the same for `.claude/`. Wrap in try/catch —
  a non-empty dir is fine, nothing to do.
- Delete `MANIFEST_RELPATH` (`fs.rmSync(..., { force: true })`).
- `console.log` "${PACKAGE_NAME}: uninstalled ${count} file(s) from
  ${consumerRoot}".

#### 2. CLI usage text

**File**: `src/cli.ts`

**Intent**: `uninstall` is no longer a stub — drop the "(stub)" tag on its line
and the blanket "skeleton stubs until change consumer-install-symlink lands"
note (install shipped in S-01). Keep the wording honest about what each command
does.

**Contract**: edit the `USAGE` template literal only — `uninstall` line reads
e.g. `Remove every file this package installed (reads the install manifest)`;
remove or narrow the trailing `Note:` line. No dispatch changes.

#### 3. Uninstall tests

**File**: `test/uninstall.test.ts`

**Intent**: Prove a full install→uninstall round-trip leaves no trace, shared
files keep their own content, and every malformed / edge state is handled
without data loss.

**Contract**: `describe("runUninstall — manifest-driven removal (S-03)")`,
tmpdir consumer root via `PROJECT_ROOT`, `console` mocked, env restored in
`afterEach` (mirror `install.test.ts` setup). Cases:
- **Round-trip**: `runInstall()` then `runUninstall()` — `.claude/skills/`,
  `.claude/`, the manifest, and a package-only `CLAUDE.md` / `.npmrc` are all
  gone; `runUninstall()` a second time logs "no manifest found" and resolves.
- **Preserves hand-written `CLAUDE.md`**: seed `# Mine\n\nkeep this\n`, install,
  uninstall — file still exists, equals the seed (block + its seam removed).
- **Preserves unrelated `.npmrc` lines**: seed `@other:registry=https://x/\n`,
  install, uninstall — file still has the `@other` line, no registry/auth line,
  not deleted.
- **`.npmrc` credential line**: install with `NODE_AUTH_TOKEN` set, uninstall —
  both the registry and the `${NODE_AUTH_TOKEN}` line are gone.
- **CRLF `CLAUDE.md`**: seed a CRLF file with hand content + a well-formed block,
  install (no-op on the block), uninstall — surrounding text byte-identical,
  still CRLF, block gone.
- **Malformed block (single marker)**: seed `#x\n\n<BEGIN>\nhalf\n`, hand-write
  a manifest listing `CLAUDE.md`, uninstall — file untouched, `console.warn`
  fired.
- **Unreadable manifest**: write `"{ not json"`, uninstall — resolves, warns,
  a sibling seeded skill link is left in place.
- **Skill path is a real directory, not a link**: manifest lists
  `.claude/skills/mine`, create it as a real dir with a file — uninstall leaves
  it, warns, still removes the rest and the manifest.
- **No manifest at all**: `runUninstall()` on a bare tmpdir resolves and logs
  "no manifest found".
- **`.claude/` kept when non-empty**: drop a `.claude/settings.json` before
  uninstall — `.claude/` survives, `.claude/skills/` and the manifest are gone.

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Type check passes: `npm run typecheck`
- Test suite passes, incl. new `test/uninstall.test.ts` and the unchanged
  `test/entrypoints.test.ts` "runUninstall resolves without throwing": `npm test`
- `npm pack --dry-run --json` allowlist unchanged

#### Manual Verification:

- Scratch consumer repo: `ai-toolkit install`, `git add -A && git commit`, then
  `ai-toolkit uninstall` → `git status` clean, `git clean -nd` shows nothing
- Repo with hand-written `CLAUDE.md` above the block and an unrelated `.npmrc`
  entry: after uninstall both files remain with only the consumer's content,
  `git diff` shows just the block / line removals
- CRLF repo (`.gitattributes` `eol=crlf`): install then uninstall → the two
  files' surviving lines keep CRLF, `git diff` shows only intended removals
- Second `ai-toolkit uninstall` prints "no manifest found, nothing to uninstall"
  and exits 0

**Implementation Note**: After this phase and all automated verification passes,
pause for manual confirmation before Phase 3 (performed in-session under the
`/goal` directive).

---

## Phase 3: Consumer uninstall documentation

### Overview

Document uninstall in `README.md` and refresh the status / layout / context
notes. Advance the roadmap. No code.

### Changes Required:

#### 1. README — "Consumer uninstall" section

**File**: `README.md`

**Intent**: Tell a consumer what `ai-toolkit uninstall` does — reads the
committed manifest, removes exactly the files it lists (skill links, the
`CLAUDE.md` block, the `.npmrc` registry/credential line), deletes files it
created that are now empty plus the manifest, and leaves everything else
untouched; it is an explicit command, not an npm hook (OQ-7), and it does not
remove the dependency from `package.json`. State it is idempotent (a second run
is a no-op) and CRLF-safe. Note the malformed-manifest posture: files are left
in place with a warning (rich candidate listing is S-05).

**Contract**: new `### Consumer uninstall` subsection under `## Consumer setup`,
after `### Consumer update`. Refresh `## Status` (S-03 lands: uninstall now
implemented; still pending S-04/S-05). Update `## Layout` — `uninstall.ts`
comment drops "(stub — S-03)"; add `src/consumer.ts` line. Update `## Context`
to list `consumer-uninstall-clean/` (S-03).

#### 2. Roadmap status

**File**: `context/foundation/roadmap.md`

**Intent**: S-03 moves from `planning` (set at plan time) to `in-progress` on
the first implementation commit.

**Contract**: `## At a glance` row S-03 Status cell → `in-progress`; item body
`### S-03:` `- **Status:**` line → `in-progress`; frontmatter `updated:` → the
commit date. (Per the 10x flow this edit is committed with **Phase 1**; listed
here for completeness.)

### Success Criteria:

#### Automated Verification:

- `npm run build && npm test` still green (no code touched, sanity only)
- `npm pack --dry-run --json` allowlist unchanged

#### Manual Verification:

- README "Consumer uninstall" section matches the implemented behaviour; the
  scope boundary with S-05 (malformed-manifest UX) is unambiguous
- `## Status`, `## Layout`, `## Context` reflect S-03 implemented and the new
  `src/consumer.ts` module

**Implementation Note**: Final phase — after verification the change is ready
for `/10x-impl-review`.

---

## Testing Strategy

### Unit / integration tests (`test/uninstall.test.ts`, Vitest, node env)

- **Round-trip**: install → uninstall leaves zero trace; second uninstall is a
  clean no-op.
- **Shared-file preservation**: hand-written `CLAUDE.md` content and unrelated
  `.npmrc` lines survive; only the package's block / two lines are removed;
  files emptied by the removal are deleted.
- **Credential line**: the `${NODE_AUTH_TOKEN}` line is removed when present.
- **CRLF**: surrounding `CLAUDE.md` text stays byte-identical and CRLF; only
  intended removals show in a diff.
- **Malformed / hostile states**: single-marker block → warn + skip; unreadable
  manifest → warn + leave everything; a skill path that is a real directory →
  warn + leave, rest still removed; `.claude/` with foreign content → kept.
- **Regression**: every existing S-01/S-02 case in `test/install.test.ts` and
  the `test/entrypoints.test.ts` uninstall assertion stay green — the Phase 1
  refactor and the CLI text change must not alter install behaviour.

### Manual testing steps

1. `npm run build && npm pack`; install the tarball into a scratch consumer repo
   (`npm i <tarball>`), let `postinstall` run `ai-toolkit install`; commit.
2. `npx ai-toolkit uninstall`; confirm `git status` clean, `git clean -nd`
   empty, the manifest and `.claude/skills/` gone.
3. Repeat with a hand-written `CLAUDE.md` (content above the block) and an
   unrelated `.npmrc` entry; confirm both files remain with only the consumer's
   content and `git diff` shows just the block / line removals.
4. Convert `CLAUDE.md` / `.npmrc` to CRLF; install then uninstall; confirm
   surviving lines keep CRLF and `git diff` shows only intended removals.
5. Corrupt the manifest to invalid JSON; run uninstall; confirm it warns and
   removes nothing.
6. Run `ai-toolkit uninstall` a second time; confirm "no manifest found,
   nothing to uninstall" and exit 0.

## Performance Considerations

Negligible — one `readFileSync` + `JSON.parse` of a small manifest, then at most
a handful of `lstat` / `rmSync` / `readdirSync` calls. No new dependencies.

## Migration Notes

No migration. Any consumer that ran S-01/S-02 already carries a five-field
manifest; uninstall reads it as-is. A consumer with no manifest gets the "no
manifest found" no-op.

## References

- Roadmap slice: `context/foundation/roadmap.md` § S-03; OQ-7
- PRD: `context/foundation/prd.md` FR-011, US-02 AC ("Deinstalacja usuwa
  dokładnie pliki z manifestu…"), § Guardrails
- Prior changes: `context/changes/consumer-install-symlink/plan.md` (S-01),
  `context/changes/consumer-update-and-reconcile/plan.md` (S-02) — the reconcile
  and CRLF-agnostic block/line editing this inverts
- Reference shape: `.claude/config-templates/m5l4-github-packages-uninstall.js.template`
- Current code: `src/uninstall.ts` (stub), `src/install.ts` — `findConsumerRoot`
  `:24`, `applyRulesBlock` `:143`, `ensureNpmrc` `:193`, `pruneWithdrawn` `:249`;
  `src/cli.ts` `USAGE` `:6`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extract shared consumer-path & EOL helpers

#### Automated

- [x] 1.1 Build passes: `npm run build` — f4d4f79
- [x] 1.2 Type check passes: `npm run typecheck` — f4d4f79
- [x] 1.3 Full test suite passes unchanged: `npm test` — f4d4f79
- [x] 1.4 `npm pack --dry-run --json` still lists only `dist/`, `skills/`, `rules/`, `bin/`, `README.md`, `package.json` — f4d4f79

#### Manual

- [x] 1.5 `git diff` shows only a move (`install.ts` → `consumer.ts`) plus one new import line — no logic change — f4d4f79

### Phase 2: Manifest-driven uninstall core + CLI

#### Automated

- [x] 2.1 Build passes: `npm run build` — 2afd6e3
- [x] 2.2 Type check passes: `npm run typecheck` — 2afd6e3
- [x] 2.3 Test suite passes, incl. new `test/uninstall.test.ts` and the unchanged `test/entrypoints.test.ts` uninstall assertion: `npm test` — 2afd6e3
- [x] 2.4 `npm pack --dry-run --json` allowlist unchanged — 2afd6e3

#### Manual

- [x] 2.5 Scratch consumer repo: install + commit, then `ai-toolkit uninstall` → `git status` clean, `git clean -nd` empty — 2afd6e3
- [x] 2.6 Hand-written `CLAUDE.md` content and an unrelated `.npmrc` entry survive uninstall; `git diff` shows only the block / line removals — 2afd6e3
- [x] 2.7 CRLF repo: install then uninstall → surviving lines keep CRLF, `git diff` shows only intended removals — 2afd6e3
- [x] 2.8 Second `ai-toolkit uninstall` prints "no manifest found, nothing to uninstall" and exits 0 — 2afd6e3

### Phase 3: Consumer uninstall documentation

#### Automated

- [x] 3.1 `npm run build && npm test` still green — 18deb54
- [x] 3.2 `npm pack --dry-run --json` allowlist unchanged — 18deb54

#### Manual

- [x] 3.3 README "Consumer uninstall" section matches implemented behaviour; scope boundary with S-05 is unambiguous — 18deb54
- [x] 3.4 `## Status`, `## Layout`, `## Context` reflect S-03 implemented and the new `src/consumer.ts` module — 18deb54
