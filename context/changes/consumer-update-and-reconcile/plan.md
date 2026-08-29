# Consumer update & withdrawn-artifact reconcile (S-02) Implementation Plan

## Overview

Harden the `@10xpackages/ai-toolkit` installer so that a consumer repo running a
standard **dependency update** (`npm update`, or a plain re-install of a newer
version) gets the new artifact content **and** loses every artifact the new
package version no longer ships — with the developer's own file content
untouched and a re-run on a clean tree producing zero diff.

S-01 already makes `runInstall()` a full forward reconcile (skill links, rules
block, `.npmrc` line, manifest). Two gaps remain, and this change closes both:

1. **Withdrawn artifacts leak.** `linkSkills()` only walks the skills the payload
   *currently* ships. A skill dropped from a new package version is never
   visited, so its stale link lingers in `.claude/skills/` forever. FR-010
   requires the installer to remove it, detected by diffing the previous
   manifest's `files[]` against the freshly-computed list.
2. **CRLF repos see a diff on every install.** `applyRulesBlock()` and
   `ensureNpmrc()` compare against and write LF-only content; a consumer repo
   that normalizes to CRLF gets `CLAUDE.md` / `.npmrc` rewritten to LF on every
   run — nicking the idempotency guarantee. S-01's impl-review (finding F1)
   explicitly deferred this fix to S-02, and roadmap S-02 pins the re-run
   idempotency NFR verification here.

## Current State Analysis

- **`src/install.ts` — `runInstall()`** (post S-01): ordered reconcile —
  `findConsumerRoot()` → `linkSkills()` → `applyRulesBlock()` → `ensureNpmrc()`
  → `writeManifest(files)`. Wrapped in try/catch; never throws (must not fail a
  consumer's `npm install`). Each step returns the consumer-root-relative POSIX
  paths it touched; `runInstall` accumulates them into `files[]`.
- **`linkSkills(consumerRoot)`** (`src/install.ts:58`): iterates
  `payloadDir("skills")` entries only. Idempotent (an owned link resolving to
  the current payload is left as-is); recreates a broken / wrong-target link;
  warns-and-skips a real (non-link) directory of the same name (collision).
  **Has no notion of a link it created last version but no longer ships.**
- **`applyRulesBlock(consumerRoot)`** (`src/install.ts:129`): create / splice
  between sentinels / append; malformed-marker state → warn + skip. Equality
  guard `if (next !== existing)` at `src/install.ts:163` is **byte-exact, LF-only**.
- **`ensureNpmrc(consumerRoot)`** (`src/install.ts:176`): append-only ensure-line;
  trimmed-string line compare at `src/install.ts:192` — **does not strip `\r`**.
- **`writeManifest(consumerRoot, files)`** (`src/install.ts:215`): writes
  `.claude/.ai-toolkit-manifest.json` only when the recomputed manifest differs
  from the stored one **ignoring `installedAt`**. Reads + `JSON.parse`s any
  existing manifest already (catch → overwrite on corrupt).
- **`ToolkitManifest`** (`src/manifest.ts:37`): `{ package, version, tool,
  installedAt, files[] }`. `files[]` is sorted, POSIX, consumer-root-relative.
  Frozen contract — `test/manifest.test.ts` locks the five-field literal.
- **Payload today**: `skills/code-review/`, `rules/CLAUDE.md`. One skill.
- **`test/install.test.ts`**: 12 cases across S-01's three phases; tmpdir
  consumer root via `PROJECT_ROOT`, `console` mocked, env restored in
  `afterEach`. This is the file the new cases join.
- **Roaming already delivers "new content" for free**: skill links point into
  `node_modules/@10xpackages/ai-toolkit/skills/`, so `npm update` swaps the
  payload and the link follows it. The rules block is re-derived from the
  payload on every `runInstall`. No code is needed for "get the new content" —
  only a regression test.
- **`src/uninstall.ts`**: still a stub (S-03). Out of scope here.

### Key Discoveries:

- The withdrawn-artifact signal is **`previousManifest.files` − `currentFiles`**
  (`src/install.ts` around the `writeManifest` call). Everything needed to
  compute it is already in memory or one `JSON.parse` away.
- Only **`.claude/skills/<name>`** entries are withdrawable in the MVP. The
  package always ships `rules/CLAUDE.md`, so `CLAUDE.md` is never "withdrawn";
  `.npmrc` is shared config. Neither is ever removed by an *update* — full block
  / line removal is uninstall's job (S-03).
- A stale entry must only be deleted **if it is still a symlink/junction this
  package owns**. If the consumer replaced it with a real directory, warn-and-skip
  — same posture as S-01's collision handling (`src/install.ts:80-87`).
- `writeManifest`'s existing corrupt-manifest `catch` (`src/install.ts:240`) is
  the precedent for the prune step's corrupt-manifest posture: don't guess what
  to delete from unparseable state — skip the prune, warn, still run the forward
  reconcile.
- The `.claude/config-templates/m5l4-github-packages-uninstall.js.template`
  reference (`for (const relPath of manifest.files) { if (relPath === "CLAUDE.md")
  continue; fs.rmSync(...) }`) shows the manifest-driven removal shape to adapt —
  but the prune here is *narrower* (skills only, ownership-checked).

## Desired End State

`runInstall()` gains a **prune step** between the forward reconcile and
`writeManifest`:

- Reads the previous `.claude/.ai-toolkit-manifest.json` (if any). Computes
  `stale = previous.files − currentFiles`.
- For each stale path under `.claude/skills/` that is still a symlink/junction
  this package owns → removes it. A stale path that is now a real directory /
  file, or is `CLAUDE.md` / `.npmrc`, is skipped with a `console.warn`.
- After pruning, if `.claude/skills/` is empty it is `rmdir`-ed (no trace).
- No previous manifest → prune is a no-op (first install).
- Corrupt previous manifest → prune is skipped with a warn; the forward
  reconcile and manifest rewrite still happen.

`applyRulesBlock()` and `ensureNpmrc()` normalize `\r\n` → `\n` before their
equality / line comparisons, and preserve the file's detected EOL style on
write. A CRLF consumer repo gets no rewrite on a no-op re-run.

**Verification of the end state:** in a scratch consumer repo, install package
"v1" (payload with two skills), then install "v2" (payload with one skill): the
dropped skill's link is gone from `.claude/skills/`, the kept skill still
resolves into `node_modules`, `CLAUDE.md` / `.npmrc` are byte-identical, the
manifest lists only the surviving files, and a third `runInstall` leaves
`git status` clean — including in a repo whose `CLAUDE.md` uses CRLF.

## What We're NOT Doing

- **Uninstall** (S-03) — removing the rules block, the `.npmrc` line, the
  manifest itself, or the whole `.claude/` footprint. The prune step only
  touches *withdrawn skill links*, never shared content.
- **Rich corrupted-manifest UX** (FR-013 / S-05) — listing candidate files for
  manual removal, file/line pointers. Here a corrupt manifest just downgrades
  the prune to a warn.
- **Copy / `npx` / manifest-less repos** (S-04).
- **Sentinel-injection guard, hard abort on malformed rules block** (FR-012 /
  FR-014 / S-05). The existing warn-skip behaviour is unchanged.
- **Any change to `ToolkitManifest`** or the sentinel constants
  (`src/manifest.ts` frozen; `test/manifest.test.ts` locks it).
- **Version-diff *content* logic** — we do not compare skill *contents* between
  versions; roaming symlinks handle content, the manifest diff handles removal.
- **Automated cross-version payload fixtures** — tests simulate a withdrawn
  artifact by seeding the manifest + a matching owned junction, not by building
  a second `skills/` tree.
- **Pruning skills that the consumer added themselves** — only entries recorded
  in *our* previous manifest are candidates.

## Implementation Approach

One new private helper in `src/install.ts`:

```
pruneWithdrawn(consumerRoot: string, currentFiles: string[]): void
```

It reads the previous manifest, diffs, and removes ownership-verified stale
skill links. `runInstall()` calls it right before `writeManifest(files)`, passing
the freshly-accumulated `files`. Because a withdrawal always changes `files[]`,
`writeManifest` will then rewrite the manifest to match reality; a no-op run
changes nothing and skips the write as today.

The CRLF fix is local to `applyRulesBlock` and `ensureNpmrc`: a small
`normalizeEol` (strip `\r`) applied to the *comparison* inputs, plus detect-and-
restore of the dominant EOL on the strings actually written. No shared module —
two call sites, a couple of lines each, kept close to where they're used
(matches the file's existing style of small local helpers).

Phases map 1:1 to the two gaps plus the doc pass, three separate commits, in the
S-01 rhythm.

## Critical Implementation Details

- **Prune runs before `writeManifest`, after every forward step.** If it ran
  after, the manifest would still list the just-deleted path for one cycle. If
  it ran before `linkSkills`, a link being legitimately re-pointed this run
  could be misread as stale.
- **Ownership check reuses S-01's test:** a path is "ours to delete" iff
  `fs.readlinkSync(p)` succeeds (it is a link) **and** its `fs.realpathSync`
  either resolves under the package payload root or is broken (target already
  gone with the old version). A real directory → `readlinkSync` throws → skip +
  warn. This is the mirror image of `linkSkills`'s `owned` probe at
  `src/install.ts:74-87`.
- **`.claude/skills/` rmdir is guarded:** only when `fs.readdirSync` returns
  empty. Never recursive. If the consumer keeps their own skills alongside ours,
  the directory stays.
- **EOL restore, not force-LF:** detect `\r\n` presence in the *original* file;
  if it dominated, re-apply `\r\n` to the block/line content before write so a
  CRLF repo stays CRLF and still gets a zero diff. Writing plain LF into a CRLF
  file would itself be the diff we're trying to kill.

## Phase 1: Withdrawn-artifact prune step

### Overview

Add `pruneWithdrawn` to `src/install.ts` and wire it into `runInstall()` before
the manifest write. Cover it with tests in `test/install.test.ts`.

### Changes Required:

#### 1. Installer core — prune step

**File**: `src/install.ts`

**Intent**: After the forward reconcile, delete every artifact the previous
install recorded that the current install no longer produces — restricted to
skill links this package provably owns. Clean up an emptied `.claude/skills/`.
Never throw; a failure downgrades to `console.warn` like the rest of the file.

**Contract**:
- New private `function pruneWithdrawn(consumerRoot: string, currentFiles: string[]): void`.
  - Resolve `MANIFEST_RELPATH`; if absent → return (first install).
  - `JSON.parse` it; on throw → `console.warn('${PACKAGE_NAME}: previous manifest
    unreadable — skipping withdrawn-artifact cleanup')` and return.
  - `stale = previous.files.filter(f => !currentFiles.includes(f))`.
  - For each `f` in `stale`:
    - Skip (no warn) if `f === "CLAUDE.md"` or `f === ".npmrc"` — shared content,
      not an update's concern.
    - Skip + `console.warn` if `f` does not start with `.claude/skills/`.
    - Probe ownership: `fs.readlinkSync(abs)` — on throw, it is a real entry the
      consumer owns → skip + `console.warn(... "left in place")`.
    - Otherwise `fs.rmSync(abs, { recursive: true, force: true })`.
  - After the loop, if `SKILLS_RELDIR` exists and `fs.readdirSync` is empty →
    `fs.rmdirSync` it.
- `runInstall()`: insert `pruneWithdrawn(consumerRoot, files)` immediately before
  `writeManifest(consumerRoot, files)`.

#### 2. Prune tests

**File**: `test/install.test.ts`

**Intent**: Prove a withdrawn skill link is removed, a surviving one is kept, and
consumer-owned / shared entries are never touched.

**Contract**: new `describe("runInstall — withdrawn-artifact reconcile (S-02)")`
with cases:
- Seed a manifest whose `files` contains `.claude/skills/ghost` plus the real
  shipped skill and `CLAUDE.md` / `.npmrc`; create `.claude/skills/ghost` as a
  junction/symlink pointing anywhere in the payload. Run `runInstall`. Assert
  `.claude/skills/ghost` is gone, the shipped skill link still `realpathSync`-es
  into the payload, and the new manifest `files` has no `ghost`.
- Ghost entry that is a **real directory** (not a link): assert it survives and
  `console.warn` fired.
- Stale `CLAUDE.md` / `.npmrc` in the seeded manifest (contrived): assert both
  files untouched, no warn for them.
- No prior manifest: `runInstall` on a clean tmpdir still succeeds, nothing
  removed.
- Corrupt prior manifest (`"{ not json"`): `runInstall` resolves, warns, forward
  reconcile still ran (shipped skill link present, manifest now valid).
- After removing the only managed skill link (seed manifest with just `ghost` as
  a skill and a payload-less run is not possible — instead: two shipped skills
  scenario is simulated by asserting `.claude/skills/` is rmdir-ed only when it
  ends up empty; keep this case light).

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Type check passes: `npm run typecheck`
- Test suite passes (incl. new S-02 cases): `npm test`
- `npm pack --dry-run` still lists only `dist/`, `skills/`, `rules/`, `bin/`,
  `README.md`, `package.json`

#### Manual Verification:

- Scratch repo: `PROJECT_ROOT=<dir> node bin/ai-toolkit.js install` with a
  hand-seeded manifest containing a `.claude/skills/legacy-thing` junction →
  re-run removes `legacy-thing`, keeps `code-review`, `git status` shows only
  the intended deletions
- A `.claude/skills/legacy-thing` that is a real directory is left in place with
  a warning

**Implementation Note**: After this phase and all automated verification passes,
pause for manual confirmation before Phase 2. (Under the `/goal` human-out-of-loop
directive, the implementer performs the manual checks in-session and records
them.)

---

## Phase 2: CRLF idempotency hardening

### Overview

Make `applyRulesBlock()` and `ensureNpmrc()` line-ending-agnostic so a CRLF
consumer repo gets a true zero-diff no-op re-run. Closes S-01 impl-review F1.

### Changes Required:

#### 1. Line-ending-agnostic comparison + EOL-preserving write

**File**: `src/install.ts`

**Intent**: Compare against content with `\r` stripped so a CRLF file is not
seen as "different"; when a write is genuinely needed, emit the file's own
dominant EOL rather than forcing LF (which would itself be a diff).

**Contract**:
- Small local helper `const stripCr = (s: string) => s.replace(/\r\n/g, "\n")`.
- `applyRulesBlock`: compute `begin`/`end` and the `next !== existing` guard
  against `stripCr(existing)` vs `stripCr(next)`. If the original used `\r\n`
  (detect via `/\r\n/.test(existing)`), convert the final string to `\r\n`
  before `writeFileSync`.
- `ensureNpmrc`: the `present(line)` compare already `trim()`s each line; extend
  it to compare `existing.replace(/\r$/, "").trim() === line`. On write, join
  with the detected EOL (`original.includes("\r\n") ? "\r\n" : "\n"`).
- New-file creation paths (no existing content) keep writing LF — unchanged.

#### 2. CRLF tests

**File**: `test/install.test.ts`

**Intent**: Lock the zero-diff-on-CRLF behaviour for both files.

**Contract**: add to the existing Phase 2 / Phase 3 `describe`s (or a new
`describe("runInstall — CRLF consumer repos (S-02)")`):
- Seed `CLAUDE.md` with `\r\n` line endings and a well-formed sentinel block →
  `runInstall` twice → file is byte-identical after the second run and still
  contains `\r\n`.
- Seed `CLAUDE.md` (CRLF) with only hand-written content, no markers → first run
  appends the block using `\r\n`, second run is byte-identical.
- Seed `.npmrc` with `\r\n` and the registry line already present → `runInstall`
  does not rewrite it.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npm run typecheck`
- Test suite passes: `npm test`
- New CRLF cases assert byte-identical files across two `runInstall` calls

#### Manual Verification:

- Scratch repo with `* text=auto eol=crlf` in `.gitattributes` and a CRLF
  `CLAUDE.md`: install then re-install → `git diff` empty, `file` / editor shows
  CRLF preserved

**Implementation Note**: Pause for manual confirmation before Phase 3 (performed
in-session under the `/goal` directive).

---

## Phase 3: Consumer update documentation

### Overview

Document the update / reconcile behaviour in `README.md` and refresh the status
section. No code.

### Changes Required:

#### 1. README — "Consumer update" section

**File**: `README.md`

**Intent**: Tell a consumer what `npm update` does: skills roam to the new
version automatically, the rules block is re-derived, artifacts withdrawn from
the new version are removed via manifest diff, and a re-run is still zero-diff.
State what update does **not** touch (out-of-band `CLAUDE.md` content, unrelated
`.npmrc` entries, the rules block on downgrade — that's uninstall).

**Contract**: new `### Consumer update` subsection under `## Consumer setup`,
plus a one-line refresh of the `## Status` paragraph (S-02 lands: update /
withdrawn-artifact reconcile now implemented; still pending S-03/S-04/S-05).
Keep the existing "What to commit" guidance; add that the manifest diff is why
committing `.ai-toolkit-manifest.json` matters for updates.

#### 2. Roadmap status

**File**: `context/foundation/roadmap.md`

**Intent**: S-02 moves from `planning` (set at plan time) to `in-progress` on
the first implementation commit.

**Contract**: `## At a glance` row S-02 Status cell → `in-progress`; item body
`### S-02:` `- **Status:**` line → `in-progress`; frontmatter `updated:` → the
commit date. (Per the 10x flow this edit is committed with **Phase 1**; listed
here for completeness.)

### Success Criteria:

#### Automated Verification:

- `npm run build && npm test` still green (no code touched, sanity only)
- `npm pack --dry-run` unchanged

#### Manual Verification:

- README "Consumer update" section reads correctly, matches the implemented
  behaviour, and the scope boundary with uninstall (S-03) is unambiguous
- `## Status` paragraph reflects S-02 done

**Implementation Note**: Final phase — after verification, the change is ready
for `/10x-impl-review`.

---

## Testing Strategy

### Unit / integration tests (`test/install.test.ts`, Vitest, node env)

- **Withdrawn prune**: ghost link removed; shipped link survives; real-dir ghost
  skipped + warned; `CLAUDE.md` / `.npmrc` never removed; no-manifest no-op;
  corrupt-manifest warn + forward reconcile still runs; empty `.claude/skills/`
  rmdir-ed only when empty.
- **CRLF idempotency**: CRLF `CLAUDE.md` (with block / without block) byte-
  identical across two runs, CRLF preserved; CRLF `.npmrc` not rewritten.
- **Regression**: all 12 existing S-01 cases stay green — the prune step and the
  compare change must not alter LF-repo behaviour.

### Manual testing steps

1. Build; `npm pack`; install the tarball into a scratch consumer repo.
2. Hand-add a `.claude/skills/legacy-thing` junction and a matching manifest
   `files` entry; run `ai-toolkit install`; confirm `legacy-thing` is gone,
   `code-review` survives, manifest updated, `git status` clean afterwards on a
   second run.
3. Repeat step 2 with `legacy-thing` as a real directory; confirm it is left
   with a warning.
4. Convert the scratch repo's `CLAUDE.md` and `.npmrc` to CRLF; run install
   twice; confirm `git diff` is empty and line endings unchanged.

## Performance Considerations

Negligible — one extra `readFileSync` + `JSON.parse` of a small manifest and at
most a handful of `lstat`/`rmSync` calls per install. No new dependencies.

## Migration Notes

No migration. Existing consumers already carry an S-01 manifest with the same
five fields; the prune step reads it as-is. A consumer with no manifest (never
ran S-01) simply gets a first install with an empty prune.

## References

- Roadmap slice: `context/foundation/roadmap.md` § S-02
- PRD: `context/foundation/prd.md` FR-010, § Idempotencja instalatora
- Prior change: `context/changes/consumer-install-symlink/plan.md` (S-01) — the
  reconcile this builds on
- S-01 impl-review finding F1 (CRLF): `context/changes/consumer-install-symlink/reviews/impl-review.md`
- Uninstall template shape: `.claude/config-templates/m5l4-github-packages-uninstall.js.template`
- Current installer: `src/install.ts` — `linkSkills` `:58`, `applyRulesBlock`
  `:129`, `ensureNpmrc` `:176`, `writeManifest` `:215`, `runInstall` `:256`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Withdrawn-artifact prune step

#### Automated

- [ ] 1.1 Build passes: `npm run build`
- [ ] 1.2 Type check passes: `npm run typecheck`
- [ ] 1.3 Test suite passes (incl. new S-02 prune cases): `npm test`
- [ ] 1.4 `npm pack --dry-run` still lists only `dist/`, `skills/`, `rules/`, `bin/`, `README.md`, `package.json`

#### Manual

- [ ] 1.5 Scratch repo: seeded `.claude/skills/legacy-thing` junction is removed on re-run, `code-review` kept, `git status` clean on the following run
- [ ] 1.6 A real-directory `legacy-thing` is left in place with a warning

### Phase 2: CRLF idempotency hardening

#### Automated

- [ ] 2.1 Type check passes: `npm run typecheck`
- [ ] 2.2 Test suite passes: `npm test`
- [ ] 2.3 New CRLF cases assert byte-identical `CLAUDE.md` / `.npmrc` across two `runInstall` calls

#### Manual

- [ ] 2.4 Scratch repo with CRLF `CLAUDE.md` + `.npmrc` and `eol=crlf` gitattributes: install then re-install → `git diff` empty, CRLF preserved

### Phase 3: Consumer update documentation

#### Automated

- [ ] 3.1 `npm run build && npm test` still green
- [ ] 3.2 `npm pack --dry-run` unchanged

#### Manual

- [ ] 3.3 README "Consumer update" section reads correctly and the scope boundary with uninstall (S-03) is unambiguous
- [ ] 3.4 `## Status` paragraph reflects S-02 implemented
