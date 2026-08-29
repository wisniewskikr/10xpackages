# Installer safe refusals (S-05) Implementation Plan

## Overview

Give the consumer a **loud, actionable refusal instead of silent damage** in the
three unsafe states the installer/uninstaller can hit:

1. **FR-012** — a corrupted team-rules block in `CLAUDE.md` (one sentinel marker
   present, its pair gone). The installer already detects this and skips; this
   change makes the warning **point at the file and the exact line** and state
   that no automatic repair is attempted.
2. **FR-014** — a team-rules payload whose own text contains the package's
   boundary markers. Writing it would let a later install mistake a planted
   marker for a real fence and delete consumer content outside the block. The
   installer must **refuse to write the block** and warn.
3. **FR-013** (nice-to-have, scoped to this slice) — when the uninstaller finds a
   corrupted manifest it already leaves every file in place; this change makes it
   **print the list of paths it would have removed** so the consumer has a manual
   cleanup path without a `--force` flag.

It also **ratifies OQ-5**: the MVP skill-name-collision policy is *warn and skip*
(a pre-existing real skill directory of the same name is left untouched and kept
out of the manifest) — no scope-prefixing, no hard abort. This slice only
documents that; the behaviour already ships from S-01.

## Current State Analysis

- **`src/install.ts` → `applyRulesBlock` (`:228`)** — reads `rules/CLAUDE.md`,
  `trim()`s it, wraps it as `${SENTINEL_BEGIN}\n${teamRules}\n${SENTINEL_END}`,
  and splices/creates/appends into `<root>/CLAUDE.md`. Malformed-marker detection
  is already there (`:248` — `(begin === -1) !== (end === -1) || (begin !== -1 &&
  end < begin)`) and downgrades to a generic `console.warn` + `return []`. There
  is **no check that `teamRules` itself contains a sentinel** before the block is
  built.
- **`src/uninstall.ts` → `removeRulesBlock` (`:44`)** — the mirror detection;
  returns `null` on a malformed block, and the caller (`:174`) emits its own
  generic warning ("one marker without its pair").
- **`src/uninstall.ts` → `runUninstall` (`:104`)** — on an unreadable manifest or
  a manifest with no `files[]` array it warns `manifest unreadable — leaving all
  files in place.` and returns. It does **not** enumerate candidates.
- **`src/manifest.ts`** — `SENTINEL_BEGIN` / `SENTINEL_END` (`<!-- BEGIN
  @10xpackages/ai-toolkit -->` / `<!-- END … -->`), `ToolkitManifest`. Frozen;
  `test/manifest.test.ts` locks the shape. No change needed.
- **`src/consumer.ts`** — home of the shared pure helpers (`stripCr`, `toCrlf`,
  `removeEmptyDirs`, path constants). The natural home for a shared
  marker-locator used by both entrypoints.
- **`src/cli.ts`** — plain `install` / `uninstall` / `--help` dispatch. No new
  command or flag is needed for this slice.
- **Contract that constrains every option below** — `runInstall` / `runUninstall`
  **never throw**: an exception must not break a consumer's `npm install`.
  Failures downgrade to `console.warn`. "Abort" in FR-012/FR-014 therefore means
  *abort the affected operation (never touch the file), let the rest of the
  reconcile proceed* — not `throw` / `process.exit`. This matches the S-01
  precedent already in `applyRulesBlock`.
- **Tests** — `test/install.test.ts` already has "skips a malformed block (single
  marker) without corrupting the file" and asserts `warn` was called;
  `test/uninstall.test.ts` covers the malformed-block skip on the uninstall side.
  Both are the seams to extend.
- **Payload today** — `rules/CLAUDE.md` (one file), `skills/code-review/SKILL.md`
  (one skill). The shipped rules payload is clean — the FR-014 guard fires on a
  *future/poisoned* payload, so its coverage is a unit test on the extracted
  builder, not an integration test that mutates the real payload.
- **Upstream grounding** — no `research.md` / `frame.md`. Authoritative sources:
  PRD `FR-012` / `FR-013` / `FR-014` + `US-02`, roadmap **S-05**
  ("Głośne odmowy instalatora przy stanach niebezpiecznych") and its OQ-5 note
  ("pełna decyzja zapada tutaj"; default warn+skip "wystarcza do wydania").

## Desired End State

- Seeding `CLAUDE.md` with a lone `BEGIN` (or lone `END`, or `END` before
  `BEGIN`) and running `install` prints a warning of the form
  `CLAUDE.md:<line>: team-rules block is corrupted — <MARKER> marker has no
  matching pair; not repairing (MVP). Fix or remove the stray marker, then
  re-install.` The file is byte-unchanged; the rest of the reconcile (skills,
  `.npmrc`, manifest) still runs. `uninstall` on the same file prints the same
  `CLAUDE.md:<line>` pointer.
- A team-rules payload containing `SENTINEL_BEGIN` or `SENTINEL_END` in its body
  causes `install` to warn (`rules/CLAUDE.md: refusing to inject the team-rules
  block — its content contains this package's boundary markers …`) and skip;
  `CLAUDE.md` is never opened or written.
- `uninstall` against a corrupted manifest prints `nothing was removed` plus a
  bulleted list of consumer-root-relative paths this package plausibly installed
  (skill entries under `.claude/skills/`, `CLAUDE.md` if it carries our block,
  `.npmrc` if it carries our lines, the manifest file itself). Nothing is
  deleted.
- `README.md` documents all three behaviours and states the finalized
  skill-name-collision policy (warn + skip), resolving OQ-5.
- `npm run build && npm test` green; `npm pack --dry-run --json` still lists only
  `dist/ skills/ rules/ bin/ README.md package.json`.

### Key Discoveries:

- Malformed-block **detection** already exists on both sides
  (`install.ts:248`, `uninstall.ts:49`) — this slice upgrades the **message**,
  not the detection.
- The never-throw contract (`install.ts:480`, `uninstall.ts:233`) means
  "abort" = warn + skip the file, not raise.
- The FR-014 threat is a *planted marker in block content*; the shipped payload
  is clean, so the guard belongs in an **extracted pure builder**
  (`buildRulesBlock`) unit-tested directly — same seam style as `removeRulesBlock`
  / `removeNpmrcLines`.
- A corrupted manifest cannot enumerate itself, so FR-013's candidate list must
  come from a **best-effort filesystem scan**, not the manifest.
- OQ-5's "full policy" is already implemented as warn + skip
  (`install.ts:61`, `install.ts:194`); S-05 only has to declare it final.

## What We're NOT Doing

- **No automatic repair** of a corrupted rules block (explicit MVP non-goal in
  FR-012).
- **No `--force` uninstall** and **no deletion path** when the manifest is
  corrupt — FR-013 is list-only.
- **No scope-prefixing** and **no hard-abort collision mode** for skill-name
  clashes — OQ-5 is resolved as warn + skip, which already ships.
- **No `throw` / `process.exit`** anywhere — the fail-soft posture of
  `runInstall` / `runUninstall` is preserved.
- **No change** to the `ToolkitManifest` shape, the sentinel constants, the CLI
  surface, or the `npm pack` allowlist.
- Nothing about CI/publish (S-06) or multi-tool profiles (OQ-2).

## Implementation Approach

Four phases, each a standalone commit, in must-have-first order (FR-012 → FR-014
→ FR-013 → docs). Phases 1–2 both touch the rules-block write path in
`applyRulesBlock` but are independent edits with independent tests; keeping them
separate keeps each commit atomic and reviewable. Every phase reuses the existing
pure-helper + Vitest-against-a-tmpdir pattern already established across
`src/consumer.ts` and `test/*.test.ts`.

## Phase 1: FR-012 — corrupted-block abort with a file/line pointer

### Overview

Turn the generic malformed-block warning (both entrypoints) into a message that
names `CLAUDE.md`, the 1-based line of the orphaned marker, which marker lacks its
pair, and that no repair is attempted.

### Changes Required:

#### 1. Shared marker locator

**File**: `src/consumer.ts`

**Intent**: Add one pure helper both entrypoints use to describe a malformed
team-rules block, so the two warnings can't drift.

**Contract**: `export function locateOrphanMarker(raw: string): { marker:
"BEGIN" | "END"; line: number } | null`. Returns `null` when the block is
well-formed (both markers present with `BEGIN` before `END`) or entirely absent
(neither marker). Returns the offending marker and its 1-based line number when
exactly one marker is present, or when `END` precedes `BEGIN` (report the `END`).
Line number is `raw.slice(0, index).split("\n").length` — CRLF-safe because
`\r\n` still contains `\n`. Imports `SENTINEL_BEGIN` / `SENTINEL_END` from
`./manifest`.

#### 2. Installer message

**File**: `src/install.ts`

**Intent**: Replace the malformed-block `console.warn` in `applyRulesBlock` with a
`CLAUDE.md:<line>` pointer built from `locateOrphanMarker`. Detection, control
flow (`return []`), and the never-throw contract are unchanged.

**Contract**: Warning text includes the substring `CLAUDE.md:<line>`, the word
`corrupted`, the missing marker name, and a "not repairing (MVP)" clause. Still
returns `[]` so `pruneWithdrawn` keeps treating `CLAUDE.md` as not-withdrawn.

#### 3. Uninstaller message

**File**: `src/uninstall.ts`

**Intent**: Give the `removeRulesBlock` → `null` branch in `runUninstall` the same
`CLAUDE.md:<line>` pointer via `locateOrphanMarker`.

**Contract**: Same message shape as the installer (minus the "re-install" tail —
use "left untouched"). Control flow (`continue`) unchanged.

#### 4. Tests

**File**: `test/install.test.ts`, `test/uninstall.test.ts`, `test/consumer.test.ts` (new)

**Intent**: Lock the new message and the helper.

**Contract**: `test/consumer.test.ts` unit-tests `locateOrphanMarker` for: both
markers well-formed → `null`; neither → `null`; lone `BEGIN` on line N → `{marker:
"BEGIN", line: N}`; lone `END` on line N → `{marker: "END", line: N}`; `END`
before `BEGIN` → reports `END`; CRLF input → correct line. Extend the existing
"skips a malformed block" test in each of `install.test.ts` / `uninstall.test.ts`
to assert the warn argument matches `/CLAUDE\.md:2\b/` for a lone-`BEGIN` fixture
and that the file bytes are unchanged.

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Type check passes: `npm run typecheck`
- Full suite passes, incl. the new `test/consumer.test.ts` and the extended
  malformed-block assertions, every existing test unchanged: `npm test`
- `npm pack --dry-run --json` still lists only `dist/`, `skills/`, `rules/`,
  `bin/`, `README.md`, `package.json`

#### Manual Verification:

- Scratch repo: `CLAUDE.md` with a lone `BEGIN` on line 3 → `install` logs a
  warning containing `CLAUDE.md:3` and "not repairing"; `git status` shows
  `CLAUDE.md` unchanged; skills + `.npmrc` + manifest still written
- Same file → `uninstall` logs the same `CLAUDE.md:3` pointer and leaves the file
  untouched

**Implementation Note**: After automated verification passes, pause for manual
confirmation before Phase 2.

---

## Phase 2: FR-014 — sentinel-injection guard

### Overview

Refuse to write a team-rules block whose payload text contains either boundary
marker, so a planted marker can never be mistaken for a real fence on a later
install.

### Changes Required:

#### 1. Extract a guarded block builder

**File**: `src/install.ts`

**Intent**: Pull the block-string construction out of `applyRulesBlock` into a
pure, exported function that returns `null` when the payload is unsafe.

**Contract**: `export function buildRulesBlock(teamRules: string): string | null`.
Returns `${SENTINEL_BEGIN}\n${teamRules}\n${SENTINEL_END}` normally; returns
`null` when `teamRules.includes(SENTINEL_BEGIN)` or
`teamRules.includes(SENTINEL_END)`. `applyRulesBlock` calls it immediately after
`fs.readFileSync(sourceFile,…).trim()`; on `null` it `console.warn`s
(`rules/CLAUDE.md: refusing to inject the team-rules block — its content contains
this package's boundary markers (sentinel-injection guard); CLAUDE.md left
untouched.`) and `return []`. `CLAUDE.md` is never read or written on that path.

#### 2. Tests

**File**: `test/install.test.ts`

**Intent**: Cover the guard at its unit seam (the shipped payload is clean, so no
integration fixture).

**Contract**: New `describe` for `buildRulesBlock`: clean input → string that
starts with `SENTINEL_BEGIN` and ends with `SENTINEL_END`; input containing
`SENTINEL_BEGIN` → `null`; input containing `SENTINEL_END` → `null`. Assert
`applyRulesBlock`'s public behaviour indirectly is unnecessary — the existing
"creates CLAUDE.md …" tests already prove the happy path still works.

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Type check passes: `npm run typecheck`
- Full suite passes incl. the new `buildRulesBlock` tests, every existing test
  unchanged: `npm test`
- `npm pack --dry-run --json` allowlist unchanged

#### Manual Verification:

- `node -e` snippet requiring the built `dist` and calling `buildRulesBlock("has
  a <!-- BEGIN @10xpackages/ai-toolkit --> inside")` returns `null`
- Reasoning recorded in the PR: with a poisoned payload the installer would warn
  and leave `CLAUDE.md` untouched; verified via the unit test because the shipped
  `rules/CLAUDE.md` is clean

**Implementation Note**: After automated verification passes, pause for manual
confirmation before Phase 3.

---

## Phase 3: FR-013 — corrupted-manifest candidate listing

### Overview

When the uninstaller can't read the manifest, print the paths it would have
removed so the consumer can clean up by hand. Still deletes nothing.

### Changes Required:

#### 1. Candidate scanner

**File**: `src/uninstall.ts`

**Intent**: Add a best-effort, read-only scan of what this package plausibly
installed.

**Contract**: `function listUninstallCandidates(consumerRoot: string): string[]`
returning consumer-root-relative POSIX paths: every direct entry under
`.claude/skills/`; `CLAUDE.md` when it exists and contains `SENTINEL_BEGIN`;
`.npmrc` when it exists and contains `REGISTRY_LINE` or `AUTH_LINE`;
`MANIFEST_RELPATH` itself. Every `fs` call wrapped so a missing dir yields `[]`
for that source. Result sorted, deduped.

#### 2. Wire into the corrupted-manifest branch

**File**: `src/uninstall.ts`

**Intent**: After the existing "manifest unreadable" warning in `runUninstall`,
emit the candidate list.

**Contract**: When the JSON parse throws or `files[]` is not an array: keep the
current warning, then `console.warn` a header (`nothing was removed — the
manifest is corrupted. Candidates for manual cleanup:`) followed by one `  -
<path>` line per `listUninstallCandidates` entry, then `return`. The "no manifest
file at all" branch (`:115`) is unchanged — nothing installed, nothing to list.

#### 3. Tests

**File**: `test/uninstall.test.ts`

**Intent**: Prove list-not-delete on a corrupt manifest.

**Contract**: Seed `.claude/.ai-toolkit-manifest.json` = `"{ not json"`, a
`.claude/skills/code-review` junction, a `CLAUDE.md` carrying the block, a
`.npmrc` carrying `REGISTRY_LINE`. Run `runUninstall`. Assert: all four still
exist; a `console.warn` call's joined arguments contain each of
`.claude/skills/code-review`, `CLAUDE.md`, `.npmrc`,
`.claude/.ai-toolkit-manifest.json`. Add a second test: no manifest file →
warning is "no manifest found" and no candidate list.

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Type check passes: `npm run typecheck`
- Full suite passes incl. the new corrupt-manifest listing tests, every existing
  test unchanged: `npm test`
- `npm pack --dry-run --json` allowlist unchanged

#### Manual Verification:

- Scratch repo with a full install, then overwrite the manifest with `garbage` →
  `uninstall` prints the bulleted candidate list matching what's on disk and
  deletes nothing; `git status` clean afterwards

**Implementation Note**: After automated verification passes, pause for manual
confirmation before Phase 4.

---

## Phase 4: Documentation + OQ-5 ratification

### Overview

Bring `README.md` and the roadmap in line with shipped S-05 behaviour and record
the OQ-5 decision.

### Changes Required:

#### 1. README

**File**: `README.md`

**Intent**: Move the S-05 items out of "Not yet implemented"; add a "Safe
refusals" subsection; state the finalized collision policy.

**Contract**: `## Status` reflects S-01..S-05 implemented. New subsection lists:
corrupted-block abort with a `CLAUDE.md:<line>` pointer and no auto-repair;
sentinel-injection guard refusing an unsafe payload; corrupted-manifest candidate
listing on `uninstall`. One sentence states the skill-name-collision policy —
"a pre-existing real skill directory of the same name is left untouched and kept
out of the manifest (warn and skip); no scope-prefix, no abort" — and notes it
**resolves OQ-5**. `## Layout` one-liners updated if wording drifted.

#### 2. Roadmap OQ-5 note

**File**: `context/foundation/roadmap.md`

**Intent**: Mark OQ-5 resolved by this slice.

**Contract**: In "Open Roadmap Questions", append to the OQ-5 line
`Resolved in S-05: warn + skip is the final MVP policy.` and drop `S-05` from its
`Block:` list. (The S-05 `Status` field is handled by the `/10x-implement` /
`/10x-archive` lifecycle, not here.)

### Success Criteria:

#### Automated Verification:

- `npm run build && npm test` green
- `npm pack --dry-run --json` allowlist unchanged

#### Manual Verification:

- README "Safe refusals" section matches implemented behaviour; the collision
  policy and OQ-5 resolution read unambiguously
- `context/foundation/roadmap.md` OQ-5 entry shows the resolution

**Implementation Note**: After automated verification passes, the change is ready
for `/10x-impl-review` and `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- `locateOrphanMarker` — well-formed / absent / lone-BEGIN / lone-END /
  out-of-order / CRLF line counting
- `buildRulesBlock` — clean payload → fenced string; payload containing either
  sentinel → `null`
- `listUninstallCandidates` — exercised through `runUninstall`'s corrupt-manifest
  path (skill entry, `CLAUDE.md` with block, `.npmrc` with line, manifest path)

### Integration Tests:

- `install` against a lone-marker `CLAUDE.md` → `CLAUDE.md:<line>` warning, file
  bytes unchanged, rest of the reconcile completes
- `uninstall` against the same file → matching pointer, file untouched
- `uninstall` against a corrupt manifest → candidate list printed, zero deletions
- Every pre-existing `install` / `uninstall` test passes unchanged (idempotency,
  CRLF, withdrawn-artifact prune, copy mode)

### Manual Testing Steps:

1. Scratch repo, `CLAUDE.md` with a lone `BEGIN` on a known line → `npx . install`
   → confirm `CLAUDE.md:<line>` + "not repairing" in output, `git status` clean
   for that file, skills/`.npmrc`/manifest present
2. Same → `npx . uninstall` → confirm same pointer, file untouched
3. `node -e 'require("./dist/install").buildRulesBlock("x <!-- BEGIN
   @10xpackages/ai-toolkit --> y")'` → `null`
4. Full install, then `echo garbage > .claude/.ai-toolkit-manifest.json` →
   `npx . uninstall` → confirm bulleted candidate list matches disk, nothing
   deleted

## Performance Considerations

None. All added work is bounded by the size of `CLAUDE.md` and the number of
entries in `.claude/skills/` — both tiny, both already walked elsewhere in the
reconcile.

## Migration Notes

No data migration. A consumer who already has a corrupted block sees the improved
message on their next `install`; no state format changes.

## References

- PRD: `context/foundation/prd.md` — FR-012, FR-013, FR-014, US-02
- Roadmap: `context/foundation/roadmap.md` — S-05, OQ-5
- Detection precedent: `src/install.ts:248`, `src/uninstall.ts:49`
- Pure-helper + tmpdir test pattern: `src/consumer.ts`, `test/install.test.ts`
- Prior slice for format: `context/changes/standalone-copy-install/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: FR-012 — corrupted-block abort with a file/line pointer

#### Automated

- [x] 1.1 Build passes: `npm run build`
- [x] 1.2 Type check passes: `npm run typecheck`
- [x] 1.3 Full suite passes, incl. new `test/consumer.test.ts` and extended malformed-block assertions: `npm test`
- [x] 1.4 `npm pack --dry-run --json` lists only `dist/`, `skills/`, `rules/`, `bin/`, `README.md`, `package.json`

#### Manual

- [x] 1.5 Scratch repo: lone `BEGIN` on line 3 → `install` warns `CLAUDE.md:3` + "not repairing", file unchanged, rest of reconcile runs
- [x] 1.6 Same file → `uninstall` logs the same `CLAUDE.md:3` pointer, file untouched

### Phase 2: FR-014 — sentinel-injection guard

#### Automated

- [ ] 2.1 Build passes: `npm run build`
- [ ] 2.2 Type check passes: `npm run typecheck`
- [ ] 2.3 Full suite passes incl. new `buildRulesBlock` tests, existing tests unchanged: `npm test`
- [ ] 2.4 `npm pack --dry-run --json` allowlist unchanged

#### Manual

- [ ] 2.5 `buildRulesBlock` with a payload containing a sentinel returns `null` (via built `dist`)
- [ ] 2.6 PR records the poisoned-payload reasoning; shipped `rules/CLAUDE.md` confirmed clean

### Phase 3: FR-013 — corrupted-manifest candidate listing

#### Automated

- [ ] 3.1 Build passes: `npm run build`
- [ ] 3.2 Type check passes: `npm run typecheck`
- [ ] 3.3 Full suite passes incl. new corrupt-manifest listing tests, existing tests unchanged: `npm test`
- [ ] 3.4 `npm pack --dry-run --json` allowlist unchanged

#### Manual

- [ ] 3.5 Scratch repo: full install, then corrupt the manifest → `uninstall` prints the candidate list matching disk and deletes nothing; `git status` clean

### Phase 4: Documentation + OQ-5 ratification

#### Automated

- [ ] 4.1 `npm run build && npm test` green
- [ ] 4.2 `npm pack --dry-run --json` allowlist unchanged

#### Manual

- [ ] 4.3 README "Safe refusals" section matches behaviour; collision policy + OQ-5 resolution unambiguous
- [ ] 4.4 `context/foundation/roadmap.md` OQ-5 entry shows the resolution
