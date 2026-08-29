# Consumer install (symlink mode) — Plan Brief

> Full plan: `context/changes/consumer-install-symlink/plan.md`

## What & Why

Fill the real reconcile logic into the `@10xpackages/ai-toolkit` installer stub
so that a consumer repo running a standard dependency install gets: team skills
laid out in `.claude/skills/`, the team rules block fenced between sentinel
markers in `CLAUDE.md`, the private-registry mapping line in `.npmrc`, and an
install manifest — with the developer's own content left untouched. This is the
roadmap **north star (S-01)**: the smallest end-to-end path that proves AI
artifacts can be distributed like any dependency without destroying the
consumer's work, and it holds the highest-risk logic in the MVP.

## Starting Point

The F-01 skeleton is green: `src/install.ts` exports a non-throwing
`runInstall()` that resolves a consumer root (`PROJECT_ROOT` → walk up to
`node_modules` → `null`) and only logs a stub line. `src/manifest.ts` freezes the
contracts — `SENTINEL_BEGIN/END`, `PACKAGE_NAME/VERSION`, and
`interface ToolkitManifest { package; version; tool; installedAt; files[] }`.
`postinstall` → `bin/ai-toolkit.js install` → `runInstall` is already wired. The
payload (`skills/code-review/`, `rules/CLAUDE.md`) ships. A CommonJS reference
installer exists in `.claude/config-templates/` to adapt (not copy).

## Desired End State

`runInstall()` reconciles a consumer root: each shipped skill dir is a
symlink/junction at `.claude/skills/<name>` pointing into `node_modules` (roaming
mode); `CLAUDE.md` carries the team rules block between sentinels with all
outside content byte-identical; `.npmrc` has the
`@10xpackages:registry=https://npm.pkg.github.com` line appended (existing
entries untouched) plus a `${NODE_AUTH_TOKEN}` reference line only when that env
var is set; `.claude/.ai-toolkit-manifest.json` lists every touched path. A
second run writes nothing — no duplicate block, no duplicate line, manifest
`installedAt` unchanged, `git status` clean.

## Key Decisions Made

All decisions taken autonomously under the `/goal` human-out-of-loop directive,
grounded in the roadmap, PRD, and frozen skeleton contracts.

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Skill placement mechanism | Symlink (POSIX) / directory **junction** (Windows) into `node_modules` | "Roaming mode" per roadmap S-01 + OQ-4; junctions need no Developer Mode / admin | Roadmap / Plan |
| Symlink target style | Absolute path to payload dir | Junctions require an absolute target; matches the ephemeral-install model | Plan |
| Name collision (skill exists as real dir) | Warn and skip | Roadmap OQ-5 documented MVP default; full policy is S-05 | Roadmap |
| Rules block insert/replace | Reuse the template's `applyRulesBlock` string logic (splice between markers, else append) | Idempotent by construction; battle-tested in the lesson material | Plan |
| Malformed sentinel state (one marker / reversed) | Minimal guard: warn + skip the rules step, no corruption | Hard abort + file/line pointer (FR-012) and injection guard (FR-014) are explicitly S-05 | Roadmap / PRD |
| `.npmrc` editing | `ensureLine` — append only the missing line, never parse/rewrite existing entries | FR-006 verbatim | PRD |
| Credential line | Literal `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}`, gated on the env var, done in Node not `echo`/bash | No secret persisted (npm expands at read time); sidesteps the OQ-4 shell dependency | PRD / Plan |
| Manifest write | Skip the write when the recomputed manifest equals the stored one ignoring `installedAt` | NFR pins idempotency down to the manifest's own bytes | PRD |
| `ToolkitManifest` shape | Unchanged; per-path uninstall semantics documented in the plan, not the type | `test/manifest.test.ts` locks the five-field literal; FR-009 lists exactly those fields | Plan |
| `vitest` v4 bump | Fold into Phase 1 | F-01 impl-review F1 deferred it to "when S-01 touches the harness" — that is now | Prior review |

## Scope

**In scope:** skill symlink/junction layout with idempotency + collision-skip;
sentinel-fenced rules block insert/replace preserving out-of-band content;
`.npmrc` ensure-line + conditional `NODE_AUTH_TOKEN` reference; manifest write
with change detection; consumer-setup README + OQ-6 recommendation; `vitest` v4
bump.

**Out of scope:** update / withdrawn-artifact reconcile (S-02); uninstall (S-03);
copy mode / `npx` / manifest-less repos (S-04); rich unsafe-state refusals +
FR-012 + FR-014 + full collision policy (S-05); CI workflow + consumer auth flow
design (S-06/S-07); multi-tool profiles, `prompts/`/`config-templates/` payload
(Non-Goals); any change to the frozen contracts.

## Architecture / Approach

Rewrite `src/install.ts` as an ordered reconcile in `runInstall()`:
`findConsumerRoot()` (reused) → `linkSkills()` → `applyRulesBlock()` →
`ensureNpmrc()` → `writeManifest(files)`. Each step returns the consumer-root-
relative POSIX paths it touched; `runInstall()` accumulates them into `files[]`
and writes the manifest last. The whole body stays wrapped so nothing escapes as
an `npm install` failure. Payload paths resolve via
`path.join(__dirname, "..", <dir>)`, which is correct from both `dist/` and
`src/` (Vitest) layouts. Phases map 1:1 to the reconcile steps.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Skill symlink layout + manifest | `linkSkills` + change-detecting `writeManifest`; new `test/install.test.ts`; `vitest` v4 bump | Windows junction behaviour; manifest idempotency (`installedAt` churn) |
| 2. Rules block injection | `applyRulesBlock` step, out-of-band preservation, malformed guard | Idempotent append↔replace producing identical bytes |
| 3. `.npmrc` line + conditional credential | `ensureNpmrc` step, no-secret guarantee, README consumer setup + OQ-6 | Not clobbering an existing consumer registry mapping; token never written |

**Prerequisites:** F-01 skeleton (done, green). No new dependencies beyond the
`vitest` major bump.
**Estimated effort:** ~1–2 sessions across 3 phases; three separate commits.

## Open Risks & Assumptions

- **OQ-4 (Windows)** — junctions should need no elevation, but the real
  `npm install`-of-tarball path on clean Windows is only proven in Phase 3 manual
  verification, not automated. Non-blocking for the plan.
- **Explicit-CLI-in-consumer-repo** relies on `__dirname` being under
  `node_modules`; a global/`npx` invocation resolves to `null` and no-ops — that
  path is S-04's, intentionally.
- Assumes `NODE_AUTH_TOKEN` is the credential env var (the `actions/setup-node`
  convention); `GITHUB_TOKEN` as an alternate trigger is a possible later
  extension.
- Assumes the consumer's rules file is root `CLAUDE.md` (Claude Code only — PRD
  Non-Goals; OQ-2).

## Success Criteria (Summary)

- A consumer `npm install` lays out skills, the rules block, the `.npmrc` line,
  and a valid manifest — developer's own `CLAUDE.md` sections and `.npmrc`
  entries untouched.
- Running install twice produces zero diff (idempotency guardrail + NFR).
- No credential value is ever written to the consumer repo; a missing env var
  does not block the install.
