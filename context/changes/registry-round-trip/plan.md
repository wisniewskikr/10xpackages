# Registry Round Trip (S-07) Implementation Plan

## Overview

Close the publish→consume loop. S-06 made "merge to `main`" publish a new
`@10xpackages/ai-toolkit` version to the org's private GitHub Packages registry.
S-01–S-05 made a consumer `npm install` reconcile skills, the rules block, the
`.npmrc` mapping line and the manifest. Nothing yet proves the two halves meet on
a **real packed artifact** installed the way a consumer repo installs it, and
nothing documents what a consumer repo commits and runs in **its own CI** to pull
a published version with a short-lived credential.

This change adds (1) a round-trip integration test that packs the tarball and
installs it into a throwaway consumer project — exercising `postinstall` →
`ai-toolkit install` end to end — and (2) a copy-pasteable consumer CI workflow
plus the consumer-CI documentation (opt-in registry-mapping line, ephemeral
`GITHUB_TOKEN`, the one-time package→repo read-access setting). No `src/`
behaviour changes.

## Current State Analysis

- **Publisher half is done (S-06).** `.github/workflows/publish-ai-toolkit.yml`
  publishes on push to `main` behind a diff gate + duplicate-version guard, auth
  via `secrets.GITHUB_TOKEN` → `NODE_AUTH_TOKEN`. `package.json#files` ships
  `dist/ skills/ rules/ bin/ .github/ README.md`.
- **Consumer half is done (S-01–S-05).** `src/install.ts#runInstall()` resolves a
  consumer root (`PROJECT_ROOT` test override → walk up to `node_modules` parent →
  `cwd` copy-mode fallback → `null` for a checkout of the toolkit itself), then
  links skills, splices the sentinel-fenced rules block, `ensureLine`s the
  `.npmrc` mapping line, conditionally adds
  `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` **only when that env var
  is set**, and writes `.claude/.ai-toolkit-manifest.json`. It never throws out
  of `postinstall`.
- **Test coverage stops at the unit boundary.** Every existing test calls
  `runInstall()` directly against `src/` with `PROJECT_ROOT` set
  (`test/install.test.ts`), or shells `npm pack --dry-run --json` to inspect the
  allowlist (`test/package-structure.test.ts`). No test installs the **built,
  packed** tarball into a project and lets npm run the real `postinstall` with
  the real `node_modules` walk.
- **Consumer setup docs are install-only.** README "Consumer setup" covers the
  committed `.npmrc` mapping line and `postinstall` reconcile for a developer
  machine. There is no consumer-**CI** guidance: how `npm ci` in a consumer repo
  authenticates to the private registry, which permission the job needs, and the
  one-time Package settings step that grants a sibling repo read access.
- **No consumer-side artifacts exist.** There is no separate consumer repository
  in this repo; the roadmap outcome is "a consumer repo opts in with one mapping
  line and its CI pulls the published version". The deliverable here is therefore
  the artifacts a consumer copies + a test that proves the contract holds against
  the packed package, not a live registry pull (the private registry and its
  credentials are not reachable from the test suite).
- **Roadmap S-07 is `proposed`**, Prerequisites `S-06, S-01` (both `in-progress`,
  functionally complete). `/10x-plan`'s roadmap sync moves it to `planning`;
  Phase 3 of implementation moves it to `in-progress`.

## Desired End State

- `test/round-trip.test.ts` runs in the normal `npm test` suite. It builds +
  packs the package once, then for a throwaway consumer project (real
  `package.json`, committed `.npmrc` mapping line) runs `npm install <tarball>`
  and asserts the full consumer contract: skill entry resolves to the payload
  `SKILL.md`; `CLAUDE.md` carries the rules block between the sentinels; the
  manifest has all five fields with `package`/`version` matching the package;
  `.npmrc` still carries the mapping line exactly once and — with
  `NODE_AUTH_TOKEN` unset — no `_authToken` line; a second install run produces
  byte-identical files (manifest `installedAt` unchanged). A companion case with
  `NODE_AUTH_TOKEN` set asserts the literal `${NODE_AUTH_TOKEN}` reference line
  appears (never the token value).
- `examples/consumer-ci.yml` is a minimal, copy-pasteable consumer GitHub Actions
  workflow: `actions/setup-node` with `registry-url` + `scope`,
  `permissions: packages: read`, `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`,
  `npm ci`. It ships **only in the source repo** — `.npmignore` keeps it out of
  the published tarball, locked by a `test/package-structure.test.ts` assertion.
- README has a "Consumer CI — registry round trip" section: the opt-in mapping
  line (commit it; never a token), the ephemeral-credential flow, the note that
  `actions/setup-node` provides the **fetch** auth (the installer's conditional
  auth line is for the installer's own writes, which run *after* the fetch), and
  the one-time "grant this repo read access to the package" Package setting.
- README "Context" section lists `registry-round-trip/` (S-07). Roadmap S-07 →
  `in-progress`.
- `npm test`, `npm run typecheck`, `npm run build`, `npm pack --dry-run` all
  green.

### Key Discoveries:

- `runInstall()`'s roaming path keys off "an ancestor `node_modules/` whose
  parent contains `process.cwd()`" (`src/consumer.ts#resolveTarget`). A tarball
  install runs `postinstall` with cwd `<consumer>/node_modules/@10xpackages/ai-toolkit`
  — that walk resolves to `<consumer>`, link mode. The round-trip test exercises
  exactly this, which no `PROJECT_ROOT`-based test does.
- `npm pack` runs `prepack` (none here) but **not** `prepublishOnly`/`pretest`,
  so `dist/` must already exist when the test packs. `npm test` is preceded by
  `pretest: npm run build` (`package.json`), so `dist/` is present by the time
  Vitest runs — the test still packs defensively but must not assume a clean
  build itself.
- The package has **zero runtime dependencies** (only `devDependencies`), so
  `npm install <tarball>` needs no registry round trip of its own —
  `--prefer-offline --no-audit --no-fund` is enough and keeps the test
  network-free.
- `test/package-structure.test.ts` already parses `npm pack --dry-run --json` and
  asserts `src/`, `test/`, `context/`, `.claude/` are excluded — adding
  `examples/` to that exclusion list is a one-line extension of an existing loop.
- `actions/setup-node` with `registry-url`+`scope` writes a job-scoped `.npmrc`
  with `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` for the *fetch*.
  Cross-repo private-package read with `secrets.GITHUB_TOKEN` additionally
  requires the package's "Manage Actions access" to list the consumer repo — a
  GitHub UI step, documentation only.
- Existing tests use `mkdtempSync(join(tmpdir(), "ai-toolkit-consumer-"))` +
  `rmSync(..., { recursive: true, force: true })` in `afterEach`; the round-trip
  test follows the same temp-dir lifecycle.

## What We're NOT Doing

- **No live registry pull.** The test does not authenticate to GitHub Packages or
  fetch a published version — the private registry and its credentials are out of
  reach of CI tests. The round trip is proven against the real packed artifact
  installed as a dependency; the network leg is covered by documentation + the
  S-06 publish workflow.
- **No changes to `src/`** — no installer / uninstaller / CLI behaviour change.
  Only `test/` and docs/config.
- **No consumer repository** scaffolded in this repo, and no separate
  `consumer/` fixture directory committed — the test builds its fixture in a
  temp dir at run time.
- **No shipping the consumer workflow in the tarball** — it is a source-repo
  example a consumer copies; keeping it out of the published package avoids a
  second workflow file that would try to run in this repo.
- **No OIDC / AWS / CodeArtifact**, no automated versioning (OQ-1), no multi-tool
  profiles (OQ-2), no Windows-shell auth-line work (OQ-4 stays open, noted in
  docs).
- **No `master` branch support**, no GitHub Release objects, no changelog.

## Implementation Approach

Three phases, one commit each.

1. **Round-trip integration test** — the proof the loop closes. New
   `test/round-trip.test.ts`: build (defensive) + `npm pack --pack-destination`
   once in `beforeAll`; per case, `mkdtemp` a consumer root, write a fixture
   `package.json` + `.npmrc`, `npm install <tarball>` with a controlled `env`,
   assert the consumer contract and idempotency, `rmSync` in cleanup. Generous
   per-test timeout for the cold `npm install`.
2. **Consumer CI example + docs** — `examples/consumer-ci.yml`; `.npmignore`
   gains `examples/`; `test/package-structure.test.ts` asserts `examples/` is not
   packed. README "Consumer CI — registry round trip" section.
3. **Roadmap + README context sync** — roadmap S-07 → `in-progress`; README
   "Context" lists `registry-round-trip/`; `change.md` → `implemented` is left to
   `/10x-implement`'s own bookkeeping.

## Critical Implementation Details

- **`dist/` must exist before the test packs.** The suite's `pretest` build
  guarantees it under `npm test`, but a bare `vitest run test/round-trip.test.ts`
  would pack a stale or missing `dist/`. `beforeAll` runs `npm run build` (or
  asserts `dist/cli.js` exists and skips with a clear message) so the file is
  self-contained. Keep the build call idempotent and quiet.
- **Fetch auth vs installer auth ordering (docs).** In consumer CI the private
  package is fetched *before* any `postinstall` runs, so the fetch credential
  must come from `actions/setup-node` (or a pre-written job `.npmrc`), **not**
  from the installer's conditional `${NODE_AUTH_TOKEN}` line — that line is
  written by `postinstall`, i.e. after the fetch, and only helps subsequent
  installer re-runs. The README section must state this explicitly or a reader
  will assume the installer bootstraps its own fetch auth.
- **Keep the round-trip test network-free.** Always pass
  `--prefer-offline --no-audit --no-fund` to `npm install`; the package has no
  runtime deps so this resolves purely from the tarball. If a sandbox still
  blocks npm, the test should fail loudly (not silently skip) so the gap is
  visible.
- **Windows temp-dir + junction.** On Windows the skill entry is a directory
  junction; assertions must use `fs.realpathSync` / `existsSync(join(link,
  "SKILL.md"))` rather than `readlinkSync` string comparison, matching
  `test/install.test.ts`.

## Phase 1: Round-trip integration test

### Overview

Add `test/round-trip.test.ts` proving that the built, packed package, installed
the way a consumer installs it, produces the documented consumer state and is
idempotent.

### Changes Required:

#### 1. Round-trip test

**File**: `test/round-trip.test.ts` (new)

**Intent**: Exercise the full publish-artifact → consume path against the real
tarball: pack the package, `npm install` it into a throwaway consumer project so
npm runs `postinstall` → `ai-toolkit install` through the real `node_modules`
walk, then assert the consumer contract and a diff-free second run. Cover both
`NODE_AUTH_TOKEN` unset (no credential line) and set (literal env-var reference,
never the value).

**Contract**:
- `beforeAll`: ensure `dist/cli.js` exists (run `npm run build` if not);
  `execSync("npm pack --pack-destination <tmp> --json", { cwd: repoRoot })`,
  parse the JSON for the `.tgz` filename, keep its absolute path. `afterAll`
  removes the tmp pack dir.
- Per case: `consumerRoot = mkdtempSync(tmpdir()+"/ai-toolkit-roundtrip-")`;
  write `package.json` (`{ name: "consumer-fixture", private: true, version:
  "0.0.0" }`) and `.npmrc`
  (`@10xpackages:registry=https://npm.pkg.github.com\n`); `execSync("npm install
  --prefer-offline --no-audit --no-fund " + tarball, { cwd: consumerRoot, env })`
  where `env` is `{ ...process.env }` with `NODE_AUTH_TOKEN` deleted or set to
  `"round-trip-token"`.
- Assertions (unset case):
  - `existsSync(join(consumerRoot, ".claude/skills/code-review/SKILL.md"))` is
    true; `realpathSync` of the link ends at the package's `skills/code-review`.
  - `CLAUDE.md` contains `SENTINEL_BEGIN` before `SENTINEL_END` with non-empty
    body between (compare against `buildRulesBlock()` output, imported from
    `../src/install`).
  - Manifest at `.claude/.ai-toolkit-manifest.json` parses to a `ToolkitManifest`
    with `package === PACKAGE_NAME`, `version === PACKAGE_VERSION`,
    `tool === "claude-code"`, non-empty `files[]` including the skill entry and
    `CLAUDE.md`.
  - `.npmrc` contains `@10xpackages:registry=https://npm.pkg.github.com` exactly
    once and **no** line matching `/_authToken=/`.
  - Idempotency: capture the bytes of `CLAUDE.md`, `.npmrc`, the manifest; run
    the installer again via
    `execSync("node bin/ai-toolkit.js install", { cwd: join(consumerRoot,
    "node_modules/@10xpackages/ai-toolkit") })`; re-read and assert byte-equal
    (in particular manifest `installedAt` unchanged).
- Assertions (set case): `.npmrc` additionally contains the literal
  `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` and does **not** contain
  the string `round-trip-token`.
- `afterEach`: `rmSync(consumerRoot, { recursive: true, force: true })`.
- Timeout: `it(name, { timeout: 120_000 }, …)` (or `describe`-level) for the
  cold `npm install`.

### Success Criteria:

#### Automated Verification:

- Build succeeds: `npm run build`
- Type checking passes: `npm run typecheck`
- New test passes in isolation: `npx vitest run test/round-trip.test.ts`
- Full suite passes: `npm test`
- Lint/format clean (repo has no separate lint step; `typecheck` covers types)

#### Manual Verification:

- On a clean Windows checkout, `npx vitest run test/round-trip.test.ts` passes
  (junction path, no Developer Mode) — OQ-4 spot check.
- Test run leaves no `ai-toolkit-roundtrip-*` temp dirs and no stray `.tgz`
  behind.
- Deliberately breaking the installer (e.g. skip the manifest write) makes the
  round-trip test fail with a clear assertion message, confirming it actually
  guards the contract.

**Implementation Note**: After Phase 1 automated verification passes, pause for
human confirmation of the manual checks before Phase 2.

---

## Phase 2: Consumer CI example + documentation

### Overview

Give a consumer repo a concrete workflow to copy and the prose explaining the
opt-in and the credential model. Keep the example out of the published tarball.

### Changes Required:

#### 1. Consumer CI workflow example

**File**: `examples/consumer-ci.yml` (new)

**Intent**: A minimal, copy-pasteable GitHub Actions workflow a consumer repo
drops into its own `.github/workflows/` to pull the published toolkit version
with a short-lived credential. Not wired to run in this repo.

**Contract**: `on: [workflow_dispatch]` plus a weekly `schedule`; `permissions:
{ contents: read, packages: read }`; one `ubuntu-latest` job — `actions/checkout`,
`actions/setup-node@v4` with `node-version: 20`, `registry-url:
https://npm.pkg.github.com`, `scope: "@10xpackages"`, then `npm ci` with
`env: NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. A header comment states the
two consumer prerequisites: commit `.npmrc` with the single mapping line, and add
`@10xpackages/ai-toolkit` to `package.json` dependencies.

#### 2. Keep the example out of the tarball

**File**: `.npmignore`

**Intent**: `examples/` is source-repo-only; it must not appear in
`npm publish`.

**Contract**: add an `examples/` line alongside the existing `src/`, `test/`,
`context/`, `.claude/` entries.

#### 3. Lock the exclusion

**File**: `test/package-structure.test.ts`

**Intent**: Assert `examples/` never ships, next to the existing "excludes
sources, tests, context docs, and .claude" check.

**Contract**: extend the `for (const path of paths)` loop with
`expect(path.startsWith("examples/")).toBe(false)`.

#### 4. Consumer CI documentation

**File**: `README.md`

**Intent**: New "Consumer CI — registry round trip" section (after "CI publish on
merge") describing the opt-in and the credential flow end to end.

**Contract**: covers — the committed `.npmrc` mapping line is the whole opt-in
(link to `examples/consumer-ci.yml`); `npm ci` in CI authenticates via
`actions/setup-node` + `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, no stored
PAT; `permissions: packages: read`; the fetch credential comes from
`setup-node`, **not** the installer's conditional `${NODE_AUTH_TOKEN}` line
(which `postinstall` writes *after* the fetch, for later re-runs); one-time
GitHub step — the package's "Manage Actions access" must grant the consumer repo
read access; local developers use `npm login` instead; Windows shell auth-line
caveat stays open (OQ-4).

### Success Criteria:

#### Automated Verification:

- `test/package-structure.test.ts` passes with the new exclusion:
  `npx vitest run test/package-structure.test.ts`
- `examples/consumer-ci.yml` is absent from `npm pack --dry-run --json` output
- Full suite passes: `npm test`
- `npm run typecheck` passes

#### Manual Verification:

- `examples/consumer-ci.yml` is valid YAML and reads as a workflow a consumer
  could paste unmodified except for their own trigger schedule.
- README section is accurate against `examples/consumer-ci.yml` and the S-01
  installer behaviour — no contradiction with the existing "Consumer setup"
  section.
- A reader following only the README can enumerate every step to make a sibling
  repo a consumer whose CI pulls the package.

**Implementation Note**: After Phase 2 automated verification passes, pause for
human confirmation before Phase 3.

---

## Phase 3: Roadmap + README context sync

### Overview

Reflect S-07 as active work and list the change folder in the README.

### Changes Required:

#### 1. Roadmap status

**File**: `context/foundation/roadmap.md`

**Intent**: Move S-07 from `planning` (set by `/10x-plan`) to `in-progress`, in
both the "At a glance" table and the S-07 item body; bump frontmatter `updated:`.

**Contract**: "At a glance" row `S-07` Status cell → `in-progress`; the
`### S-07:` block's `- **Status:**` line → `in-progress`; frontmatter
`updated: 2026-08-29`. Forward-only — never regress a more-advanced status.

#### 2. README context list

**File**: `README.md`

**Intent**: Add `registry-round-trip/` (S-07) to the "Context" section's list of
per-change plans.

**Contract**: append to the existing `context/changes/` enumeration:
`registry-round-trip/` (S-07).

### Success Criteria:

#### Automated Verification:

- Full suite still green: `npm test`
- `git grep -n "registry-round-trip" README.md` shows the new entry
- Roadmap S-07 shows `in-progress` in both locations:
  `git grep -n "S-07" context/foundation/roadmap.md`

#### Manual Verification:

- Roadmap "At a glance" and the S-07 body agree on `in-progress`.
- README "Context" section lists all seven change folders.

**Implementation Note**: This is the final phase; after it, `/10x-implement`
stamps `change.md` and the change is ready for `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- No new unit tests — `src/` is untouched. Existing `test/install.test.ts`,
  `test/uninstall.test.ts`, `test/manifest.test.ts`, `test/consumer.test.ts`,
  `test/entrypoints.test.ts` continue to cover the reconcile logic at the unit
  level.

### Integration Tests:

- `test/round-trip.test.ts` — pack the real tarball, `npm install` it into a
  temp consumer project, assert skills / rules block / manifest / `.npmrc`
  (mapping-only and, separately, with the conditional credential line) and a
  byte-identical second install run.
- `test/package-structure.test.ts` — extended to assert `examples/` stays out of
  the published tarball.

### Manual Testing Steps:

1. `npm test` — whole suite green, including the new round-trip case.
2. On Windows: `npx vitest run test/round-trip.test.ts` — passes with directory
   junctions and no elevation (OQ-4 spot check).
3. Read `examples/consumer-ci.yml` + the new README section together; confirm a
   consumer could follow them to a working CI pull with no missing step.
4. `npm pack --dry-run` — output contains no `examples/` path.

## Performance Considerations

`test/round-trip.test.ts` shells out to `npm pack` once and `npm install` once or
twice per case — each `npm install` is a few seconds cold. Pack once in
`beforeAll`, keep the number of `npm install` cases small (one unset-token case
with an in-process idempotency re-run, one set-token case), and set a 120 s
per-test timeout. Total added suite time budget: under ~60 s.

## Migration Notes

None. No published version, manifest shape, workflow, or installer behaviour
changes. `.npmignore` gains one line; the published tarball contents are
unchanged (it never included `examples/`).

## References

- Roadmap slice: `context/foundation/roadmap.md` → S-07 `registry-round-trip`
- PRD: `context/foundation/prd.md` → US-01, US-02, FR-003, FR-005, FR-006;
  "Access Control" (consumer reads with an ephemeral CI credential; opt-in via
  one committed mapping line)
- Publisher half: `context/changes/ci-publish-on-merge/plan.md` (S-06) —
  "What We're NOT Doing" hands consumer-side CI to this change
- Consumer half: `context/changes/consumer-install-symlink/plan.md` (S-01);
  `src/install.ts`, `src/consumer.ts`, `src/manifest.ts`
- Existing harness patterns: `test/install.test.ts` (temp consumer dir
  lifecycle), `test/package-structure.test.ts` (`npm pack --json` inspection)
- Consumer templates: `.claude/config-templates/m5l4-github-packages-consumer.npmrc.template`,
  `.claude/prompts/m5l4-github-packages-spec-pack.md` ("Authentication behavior")

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Round-trip integration test

#### Automated

- [x] 1.1 Build succeeds: `npm run build` — 177d09a
- [x] 1.2 Type checking passes: `npm run typecheck` — 177d09a
- [x] 1.3 New test passes in isolation: `npx vitest run test/round-trip.test.ts` — 177d09a
- [x] 1.4 Full suite passes: `npm test` — 177d09a
- [x] 1.5 Lint/format clean (typecheck covers types; no separate lint step) — 177d09a

#### Manual

- [x] 1.6 Clean-Windows `npx vitest run test/round-trip.test.ts` passes (junction, no Developer Mode) — 177d09a
- [x] 1.7 Test run leaves no `ai-toolkit-roundtrip-*` temp dirs and no stray `.tgz` — 177d09a
- [x] 1.8 Breaking the installer makes the round-trip test fail with a clear message — 177d09a

### Phase 2: Consumer CI example + documentation

#### Automated

- [x] 2.1 `test/package-structure.test.ts` passes with the new `examples/` exclusion — de2b1e1
- [x] 2.2 `examples/consumer-ci.yml` absent from `npm pack --dry-run --json` — de2b1e1
- [x] 2.3 Full suite passes: `npm test` — de2b1e1
- [x] 2.4 `npm run typecheck` passes — de2b1e1

#### Manual

- [x] 2.5 `examples/consumer-ci.yml` is valid YAML, paste-ready for a consumer — de2b1e1
- [x] 2.6 README section is accurate against the example and S-01 installer behaviour — de2b1e1
- [x] 2.7 A reader can enumerate every step to make a sibling repo a CI consumer from the README alone — de2b1e1

### Phase 3: Roadmap + README context sync

#### Automated

- [x] 3.1 Full suite still green: `npm test`
- [x] 3.2 `git grep -n "registry-round-trip" README.md` shows the new entry
- [x] 3.3 Roadmap S-07 shows `in-progress` in both locations

#### Manual

- [x] 3.4 Roadmap "At a glance" and the S-07 body agree on `in-progress`
- [x] 3.5 README "Context" section lists all seven change folders
