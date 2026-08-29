# Installer safe refusals (S-05) — Plan Brief

> Full plan: `context/changes/installer-safe-refusals/plan.md`

## What & Why

The `@10xpackages/ai-toolkit` installer can hit three unsafe states where it
currently either warns vaguely or says nothing useful. This change makes each one
a **loud, actionable refusal instead of silent damage**: a corrupted team-rules
block is reported with a `CLAUDE.md:<line>` pointer (FR-012), a rules payload that
smuggles the package's own boundary markers is refused outright (FR-014), and an
`uninstall` against a corrupted manifest prints the paths it would have removed so
the consumer can clean up by hand (FR-013). It also ratifies OQ-5: the
skill-name-collision policy is *warn and skip*, final for the MVP.

## Starting Point

`src/install.ts` (`applyRulesBlock`) and `src/uninstall.ts` (`removeRulesBlock`)
already **detect** a malformed sentinel block and skip it with a generic warning.
`runUninstall` already leaves everything in place on an unreadable manifest — but
lists nothing. Neither entrypoint ever throws (that contract is load-bearing: an
exception must not break a consumer's `npm install`). The warn+skip collision
behaviour from S-01 is already in place; OQ-5 just needs a decision on record.

## Desired End State

Seeding a lone `BEGIN`/`END` (or reversed order) in `CLAUDE.md` and running
`install` prints `CLAUDE.md:<line>: … <MARKER> marker has no matching pair; not
repairing (MVP)`, leaves the file byte-identical, and completes the rest of the
reconcile. A poisoned rules payload makes `install` warn and never touch
`CLAUDE.md`. `uninstall` on a corrupted manifest prints a bulleted candidate list
and deletes nothing. `README.md` documents all three plus the collision policy.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| -------- | ------ | ---------------- | ------ |
| "Abort" semantics for FR-012/FR-014 | Warn + skip the file, no `throw`/`exit` | The never-throw fail-soft contract must not break a consumer's `npm install`; S-01 set this precedent | Plan |
| FR-012 message content | `CLAUDE.md:<line>` + which marker is unpaired + "not repairing (MVP)" | PRD FR-012 asks for a message "wskazujący plik i miejsce" | PRD |
| Marker locator placement | New pure `locateOrphanMarker` in `src/consumer.ts`, shared by both entrypoints | Prevents the install/uninstall messages from drifting apart | Plan |
| FR-014 guard seam | Extract exported pure `buildRulesBlock(teamRules) → string \| null` | Shipped payload is clean, so the guard is unit-tested at the builder, matching `removeRulesBlock`/`removeNpmrcLines` style | Plan |
| FR-013 candidate source | Best-effort filesystem scan, not the manifest | A corrupted manifest can't enumerate itself | Plan |
| FR-013 scope | Included as its own phase — read-only, no `--force`, no deletion | Roadmap scopes FR-013 to this slice "if budget allows"; it's low-risk and separable | Roadmap |
| OQ-5 collision policy | Ratify warn + skip as final; no scope-prefix, no abort | Roadmap: the S-01 default "wystarcza do wydania" and the full call is made here | Roadmap |

## Scope

**In scope:** FR-012 file/line pointer (install + uninstall parity);
FR-014 sentinel-injection guard on the rules payload; FR-013 corrupted-manifest
candidate listing; README + roadmap OQ-5 note.

**Out of scope:** automatic block repair; a `--force` uninstall or any deletion
on a corrupt manifest; scope-prefix / hard-abort collision modes; `ToolkitManifest`
or CLI changes; CI/publish (S-06); multi-tool profiles (OQ-2).

## Architecture / Approach

One new shared helper (`locateOrphanMarker` in `consumer.ts`), one extracted
guarded builder (`buildRulesBlock` in `install.ts`), one read-only scanner
(`listUninstallCandidates` in `uninstall.ts`). Each wires into an existing branch
that already has the right control flow — the edits change **messages and one
guard**, not the reconcile structure. Tests follow the established
pure-helper-unit-test + Vitest-against-a-tmpdir pattern.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| ----- | ---------------- | -------- |
| 1. FR-012 file/line pointer | `locateOrphanMarker` + richer warning on both entrypoints | Line-number off-by-one across CRLF; covered by unit tests |
| 2. FR-014 injection guard | `buildRulesBlock` refusing a payload that carries a sentinel | Guard only reachable via a future poisoned payload — unit-tested at the seam |
| 3. FR-013 candidate listing | `listUninstallCandidates` printed on a corrupt manifest, zero deletions | Scanner over-/under-reporting; asserted against seeded fixtures |
| 4. Docs + OQ-5 | README "Safe refusals" section + roadmap OQ-5 resolution | Doc drift only |

**Prerequisites:** S-01 (shipped). No new deps, no infra.
**Estimated effort:** ~1–2 sessions across 4 small commits.

## Open Risks & Assumptions

- "Abort" is read as *abort the operation, not the process*. If a reviewer wants a
  hard stop, Phase 1/2 flow changes — but that would violate the never-throw NFR,
  so this reading is deliberate.
- FR-013's scan assumes the standard layout (`.claude/skills/`, `CLAUDE.md`,
  `.npmrc`); a consumer who relocated artifacts gets an incomplete list — acceptable
  for a nice-to-have manual-cleanup aid.

## Success Criteria (Summary)

- A corrupted rules block produces a `CLAUDE.md:<line>` pointer on both `install`
  and `uninstall`; the file is never modified.
- A rules payload containing a boundary marker is refused; `CLAUDE.md` untouched.
- `uninstall` on a corrupt manifest lists cleanup candidates and deletes nothing.
- `npm run build && npm test` green; `npm pack` allowlist unchanged; every
  pre-existing test passes.
