# Consumer update & withdrawn-artifact reconcile (S-02) — Plan Brief

> Full plan: `context/changes/consumer-update-and-reconcile/plan.md`

## What & Why

A consumer repo that updates `@10xpackages/ai-toolkit` to a newer version must
get the new artifact content **and** lose every artifact the new version no
longer ships — with the developer's own file content untouched and a re-run
producing zero diff. Today the installer (S-01) reconciles *forward* only:
a skill dropped from a new package version leaves a dead link in
`.claude/skills/` forever. FR-010 requires removing it, detected by diffing the
previous install manifest against the new one.

## Starting Point

S-01 shipped a full forward reconcile in `src/install.ts`: `runInstall()` runs
`linkSkills` → `applyRulesBlock` → `ensureNpmrc` → `writeManifest(files)`, never
throws, and is idempotent on LF repos. `linkSkills` only walks skills the
payload *currently* ships. The manifest (`.claude/.ai-toolkit-manifest.json`,
frozen five-field shape) already records every file the installer created, and
`writeManifest` already reads + parses any existing one. Skill links roam into
`node_modules`, so `npm update` swaps content for free. S-01's impl-review left
one open finding (F1): CRLF consumer repos see a `CLAUDE.md` / `.npmrc` rewrite
on every install because the equality checks are LF-only — explicitly deferred
to S-02.

## Desired End State

`runInstall()` gains a prune step before the manifest write: it reads the
previous manifest, computes `stale = previous.files − currentFiles`, and removes
each stale `.claude/skills/<name>` that is still a symlink/junction the package
owns; a stale entry that became a real directory, or is `CLAUDE.md` / `.npmrc`,
is skipped with a warning; an emptied `.claude/skills/` is removed. No previous
manifest → no-op; corrupt manifest → prune skipped with a warn, forward
reconcile still runs. Separately, `applyRulesBlock` / `ensureNpmrc` become
line-ending-agnostic so a CRLF repo gets a true zero-diff re-run.

## Key Decisions Made

All decisions taken autonomously under the `/goal` human-out-of-loop directive,
grounded in the roadmap (S-02), PRD (FR-010), and the S-01 codebase.

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Withdrawn-artifact detection | Diff previous manifest `files[]` vs freshly-computed list; `stale = old − new` | FR-010 verbatim ("porównanie manifestu poprzedniej i nowej wersji") | Frame/PRD |
| What may be pruned | Only `.claude/skills/<name>` entries still a symlink/junction the package owns | Skills are the only withdrawable artifact in MVP; owned links are provably ours | Plan |
| `CLAUDE.md` / `.npmrc` on update | Never removed by prune — block is re-derived; line stays | Shared content; removal is uninstall's job (S-03) | Roadmap |
| Stale entry now a real dir/file | Warn + skip (leave it) | Consumer took ownership; mirrors S-01 collision-skip | Plan |
| Missing previous manifest | No-op prune (first install) | Nothing to reconcile against | Plan |
| Corrupt previous manifest | Skip prune + warn; forward reconcile + manifest rewrite still run | Don't guess deletions from unparseable state; rich UX is FR-013/S-05 | Roadmap/PRD |
| Empty `.claude/skills/` after prune | `rmdir` if empty (non-recursive) | Supports "bez śladu po wycofanych artefaktach" | Plan |
| Prune ordering | After all forward steps, before `writeManifest` | Manifest must reflect post-prune reality | Plan |
| "New content" on `npm update` | Already delivered by roaming symlinks + re-derived rules block — add a regression test only, no new code | S-01 architecture | Plan |
| CRLF idempotency (S-01 F1) | Fold in: strip `\r` before equality checks in `applyRulesBlock` / `ensureNpmrc`; preserve detected EOL on write | S-01 impl-review deferred it here; roadmap S-02 pins re-run idempotency NFR verification | Prior review / Roadmap |
| Test fixture for a smaller payload | Seed manifest + a matching owned junction, assert it's pruned — no second `skills/` tree | Keeps tests in one file, no fixture sprawl | Plan |

## Scope

**In scope:** manifest-diff prune step (`pruneWithdrawn`) with ownership check,
shared-content protection, corrupt/missing-manifest handling, empty-dir cleanup;
CRLF-agnostic comparison + EOL-preserving write in `applyRulesBlock` /
`ensureNpmrc`; new tests in `test/install.test.ts`; README "Consumer update"
section; roadmap S-02 status.

**Out of scope:** uninstall / rules-block removal / `.npmrc`-line removal (S-03);
copy / `npx` mode (S-04); sentinel-injection guard, hard abort on malformed
block, rich corrupted-manifest listing (FR-012/FR-013/FR-014/S-05); any change
to `ToolkitManifest` or the sentinel constants; skill-content version diffing;
CI / publish (S-06/S-07).

## Architecture / Approach

One new private helper, `pruneWithdrawn(consumerRoot, currentFiles)`, in
`src/install.ts`, called from `runInstall()` immediately before
`writeManifest(files)`. It reads the previous manifest, diffs `files[]`, and
removes ownership-verified stale skill links (the ownership probe is the mirror
of `linkSkills`'s existing `owned` check). The CRLF fix is two local
edits — a `stripCr` helper applied to comparison inputs, plus detect-and-restore
of the dominant EOL on write. No new module, no new dependency. Three phases =
three commits, matching the S-01 rhythm.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Withdrawn-artifact prune | `pruneWithdrawn` + wiring + tests | Deleting something the consumer owns; mis-classifying a re-pointed link as stale |
| 2. CRLF idempotency hardening | `stripCr` compare + EOL-preserving write in two helpers + tests | Regressing LF-repo byte-for-byte behaviour |
| 3. Consumer update docs | README "Consumer update" section + status/roadmap refresh | Scope boundary with uninstall (S-03) stated unclearly |

**Prerequisites:** S-01 (done, green). No new dependencies.
**Estimated effort:** ~1 session across 3 phases; three separate commits.

## Open Risks & Assumptions

- **Ownership probe on Windows junctions** — `fs.readlinkSync` on a junction
  behaves slightly differently than on a POSIX symlink; Phase 1 manual
  verification is on Windows to confirm the stale-link removal and real-dir skip.
- **CRLF EOL restore** — assumes a file is uniformly one EOL style; a
  mixed-ending file falls back to LF on write (acceptable, rare, and still a
  one-time normalization rather than a diff every run).
- Assumes the previous manifest is trustworthy for *what to consider* removing;
  the ownership check is the safety net against acting on a stale/malicious
  entry.
- Assumes skills are the only artifact class that can be withdrawn in the MVP
  (payload is `skills/` + `rules/CLAUDE.md`; rules always ship).

## Success Criteria (Summary)

- Updating to a package version that dropped a skill removes that skill's link
  from `.claude/skills/`; surviving skills still resolve into `node_modules`;
  `CLAUDE.md` / `.npmrc` untouched; manifest lists only surviving files.
- A re-run on a clean tree produces zero diff — including in a CRLF consumer
  repo.
- A withdrawn entry the consumer has replaced with real content is left in place
  with a warning; a missing or corrupt prior manifest never causes a wrong
  deletion.
