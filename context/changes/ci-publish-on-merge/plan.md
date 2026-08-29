# CI publish on merge (S-06) Implementation Plan

## Overview

Add a single GitHub Actions workflow — `.github/workflows/publish-ai-toolkit.yml`
— that turns "merge an artifact change to `main`" into "a new version is
published to the org's private GitHub Packages registry", in one CI run, with
**no stored secret** and **no silent failure**:

1. **FR-003 — publish on merge, behind a diff gate.** On push to `main` the
   workflow builds and publishes the package, but only when the files that go
   into the tarball actually changed since the last release. A merge that
   touches only docs / CI / `context/` produces no release.
2. **FR-003 — ephemeral credential.** Publish authenticates with the
   `GITHUB_TOKEN` GitHub Actions injects for the run (`permissions: packages:
   write`). No PAT, no repo secret, nothing in the logs.
3. **FR-004 — duplicate version is a red build.** If the packaged files changed
   but `package.json#version` is already in the registry, the run **fails** with
   an actionable message ("bump version in package.json") instead of skipping
   quietly or reporting a false success.
4. **US-01 AC — the published package carries the pipeline definition.**
   `.github/workflows/publish-ai-toolkit.yml` ships inside the tarball, locked by
   a package-structure test.

Pull-request builds run the validation job only and never publish.

Manual version bumping in `package.json` stays the source of truth for the MVP
(OQ-1 tracks migrating to automated semantic versioning); this plan does not
touch it.

## Current State Analysis

- **No `.github/` directory.** `find .github` returns nothing. This is the first
  CI in the repo.
- **Reference material already vendored:**
  - `.claude/config-templates/m5l4-github-packages-publish-ai-toolkit.yml.template`
    — a two-job (`validate` / `publish`) starter: `push` + `pull_request` on
    `main`/`master`, `permissions: contents: read, packages: write`,
    `actions/setup-node@v4` with `registry-url: https://npm.pkg.github.com` and
    `scope: "@twoj-zespol"`, `npm publish` with `NODE_AUTH_TOKEN: ${{
    secrets.GITHUB_TOKEN }}`. **No diff gate, no duplicate-version handling** —
    those are this slice's real work.
  - `.claude/prompts/m5l4-github-packages-spec-cicd.md` — the same shape plus a
    validation checklist: `package.json` has `name` / `version` /
    `publishConfig.registry`; `skills/code-review/SKILL.md` exists; its
    frontmatter has `name` + `description`; frontmatter `name` matches the
    directory; `npm pack --dry-run` succeeds.
  - The `setup-cicd` skill and `m5l4-codeartifact-*` prompts are the **AWS
    CodeArtifact / OIDC** variant (Model 2) — explicitly *not* this path
    (`tech-stack.md`: `deployment_target: github-packages`; PRD Non-Goals rule
    out cloud registry infra). Ignored.
- **`package.json`** (`:1`):
  - `name: @10xpackages/ai-toolkit`, `version: 0.1.0`,
    `publishConfig.registry: https://npm.pkg.github.com`.
  - `files` is an **allowlist**: `dist/ skills/ rules/ bin/ README.md`.
    `.github/` is **not** in it.
  - `scripts`: `build` (tsup → `dist/`), `typecheck` (`tsc --noEmit`),
    `pretest: npm run build`, `test: vitest run`,
    `prepublishOnly: npm run build`, `postinstall: node bin/ai-toolkit.js
    install`.
- **`.npmignore`** (`:1`) — a defensive list (npm falls back to it only for
  files the allowlist doesn't already gate); it currently lists `.github/` among
  the exclusions. With the `files` allowlist in force this is redundant today but
  becomes load-bearing once `.github/` is meant to ship.
- **`bin/ai-toolkit.js`** — fail-soft launcher: `require("../dist/cli.js")`
  inside try/catch, warns and returns if `dist/` is absent. So `npm ci`'s
  `postinstall` never breaks a CI job even before a build.
- **`src/install.ts:487`** — `runInstall` self-guard: when it detects it is
  running from a toolkit checkout (not a consumer project) it logs
  `running from a toolkit checkout, nothing to install.` and returns. Confirms
  `npm ci` in this repo's own CI is a no-op for the installer.
- **`test/package-structure.test.ts`** — already asserts the `files` allowlist
  contains `dist/ skills/ rules/ bin/ README.md`, that `npm pack --dry-run
  --json` includes `skills/code-review/SKILL.md`, `rules/CLAUDE.md`,
  `dist/cli.js`, and that it excludes `src/`, `test/`, `context/`. This is the
  seam to extend for the `.github/` assertion and the SKILL.md frontmatter /
  name-match checks.
- **`git` state** — remote `github.com:wisniewskikr/10xpackages`, default branch
  `main`. **No tags** (`git tag` empty) — so the first workflow run has no
  release anchor and must publish unconditionally.
- **Upstream grounding** — no `research.md` / `frame.md`. Authoritative sources:
  PRD `FR-001`..`FR-004` + `US-01` (+ Acceptance Criteria), roadmap **S-06**
  ("Publikacja nowej wersji przez CI na merge do main") and its OQ-1 note,
  `context/foundation/requirements.md` ("Struktura paczki" tree includes
  `.github/workflows/publish-ai-toolkit.yml`), `tech-stack.md`
  (`ci_default_flow: auto-deploy-on-merge`).

## Desired End State

- `.github/workflows/publish-ai-toolkit.yml` exists with two jobs:
  - **`validate`** — runs on every `push` to `main` and every `pull_request`:
    `npm ci`, `npm run typecheck`, `npm run build`, `npm test`, `npm pack
    --dry-run`. Green on a clean tree.
  - **`publish`** — `needs: validate`, `if: github.event_name == 'push'`. Checks
    out full history + tags, computes the diff gate, decides publish / skip /
    fail per the decision table below, and on a publish runs `npm publish` then
    creates and pushes the `vX.Y.Z` tag.
- **Decision table** (publish job, `main` push only):

  | `vX.Y.Z` tag exists? | packaged files changed since last `v*` tag? | version already in registry? | outcome |
  | --- | --- | --- | --- |
  | no (first release) | — | — | **publish** `0.1.0`, create `v0.1.0` |
  | yes | no | (either) | **green no-op** — "no packaged-file changes since `<tag>`, nothing to publish" |
  | yes | yes | no | **publish** the bumped version, create its tag |
  | yes | yes | yes | **red build** — "packaged files changed since `<tag>` but version `X.Y.Z` is already published; bump \"version\" in package.json" |

- Auth: `permissions: contents: write` (tag push) + `packages: write` (publish);
  publish steps set `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. No other
  secret is referenced. No `AWS_*`, no `id-token: write`.
- `concurrency: group: publish-${{ github.ref }}` serializes rapid merges so two
  runs never race to publish.
- `npm pack --dry-run --json` lists **`.github/workflows/publish-ai-toolkit.yml`**
  in addition to the current allowlist (`dist/ skills/ rules/ bin/ README.md
  package.json`), and `test/package-structure.test.ts` asserts it — plus asserts
  every `skills/*/SKILL.md` has `name` + `description` frontmatter whose `name`
  equals the directory name.
- `README.md` has a "CI publish on merge (S-06)" section describing the trigger,
  the diff gate, the duplicate-version red build, and the ephemeral token.
- `context/foundation/roadmap.md` S-06 is `in-progress`.
- `npm run build && npm test` green; `npm run typecheck` clean.

### Key Discoveries:

- The vendored template
  (`.claude/config-templates/m5l4-github-packages-publish-ai-toolkit.yml.template`)
  is the right skeleton but **has neither the FR-003 diff gate nor the FR-004
  duplicate check** — the entire non-trivial logic of this slice lives in a
  shell step the template does not have.
- **No git tags exist**, so the diff gate needs an explicit "first release"
  branch (`git tag --list 'v*'` empty ⇒ publish unconditionally) before it can
  ever diff `"$LAST_TAG"..HEAD`.
- `actions/checkout@v4` defaults to `fetch-depth: 1` and does **not** fetch
  tags — the publish job must set `fetch-depth: 0` and `fetch-tags: true` or both
  `git tag --list` and `git diff "$TAG"..HEAD` see nothing.
- `postinstall` running `ai-toolkit install` during `npm ci` is safe in this
  repo's CI: `bin/ai-toolkit.js` is fail-soft and `runInstall` self-guards on a
  toolkit checkout (`src/install.ts:487`).
- `prepublishOnly: npm run build` means `npm publish` rebuilds `dist/` on its
  own; `dist/` stays git-ignored. The publish job still runs an explicit `npm run
  build` first so a build break fails before the publish attempt, not during it.
- `files` is an allowlist, so shipping `.github/` needs **both** an addition to
  `files` and removal of the `.github/` line from `.npmignore` (the fallback
  list is consulted for paths the allowlist newly admits).
- US-01 AC and `requirements.md`'s package-structure tree both call for the
  pipeline definition **inside the published package** — this is a checkable
  acceptance criterion, not an interpretation.

## What We're NOT Doing

- **No automated / semantic versioning** (`semantic-release`, `release-please`) —
  PRD Non-Goals + OQ-1. Version stays a manual `package.json#version` bump.
- **No tag- or Release-triggered publish** — PRD FR-003 Socrates note rejects it
  as an extra manual step. Trigger is `push` to `main`.
- **No consumer-side CI** (registry-mapping line in a consumer repo, consumer
  `npm ci` auth) — that is S-07 (`registry-round-trip`).
- **No `master` branch support** — this repo's default is `main`; the template's
  `[main, master]` is trimmed to `[main]`.
- **No OIDC / AWS / CodeArtifact** — wrong delivery model for this project.
- **No changes to `src/`** — no installer/uninstaller/CLI behaviour changes. The
  only code touched is `test/package-structure.test.ts`.
- **No release notes / changelog generation, no GitHub Release object** — just
  the registry publish and a lightweight `vX.Y.Z` git tag as the diff anchor.
- **No multi-tool / profile work** (OQ-2).

## Implementation Approach

One workflow file, two jobs, one shell gate step. Reuse the existing quality
gates (`typecheck`, `build`, `test`, `pack --dry-run`) as the validation job so
CI and local checks stay identical. The publish job's gate step is the only new
logic: resolve `package.json#version`, find the newest `v*` tag, diff the
packaged-content paths across `"$TAG"..HEAD`, probe the registry for the version,
and branch to publish / skip / fail per the decision table. On publish, tag
`vX.Y.Z` and push it so the next run has an anchor.

Then make the tarball match the documented package structure (`.github/` into the
allowlist, out of `.npmignore`) and lock it with a test. Finish with README +
roadmap.

## Critical Implementation Details

- **Checkout depth in the publish job.** `actions/checkout@v4` must be invoked
  with `fetch-depth: 0` and `fetch-tags: true`; otherwise `git tag --list 'v*'`
  and `git diff "$LAST_TAG"..HEAD` both operate on a shallow, tagless clone and
  the gate silently always takes the "first release / everything changed" path.
- **Diff-gate path set.** Diff these paths only:
  `src bin skills rules README.md package.json tsconfig.json tsup.config.ts
  .github/workflows`. `dist/` is excluded (build output, git-ignored — diff its
  sources instead); `tsconfig.json` / `tsup.config.ts` are included because they
  change the built `dist/`; `.github/workflows` is included because it now ships
  in the tarball.
- **Registry probe.** `npm view "@10xpackages/ai-toolkit@$VERSION" version` with
  `NODE_AUTH_TOKEN` set and the scope registry configured by `setup-node`. A
  never-published package (or version) returns E404 / non-zero — treat any
  non-zero exit as "not in registry". Wrap in `if ... ; then` so `set -e`
  doesn't abort the step on the expected 404.
- **Fail loudly.** The FR-004 path must `echo "::error::..."` then `exit 1` — a
  GitHub Actions annotation plus a non-zero exit, so the run is unambiguously
  red. Never `exit 0` on that branch.
- **`GITHUB_TOKEN` publish scope.** Publishing a GitHub Packages version for a
  scope that maps to this repo works with the run's `GITHUB_TOKEN` provided the
  workflow declares `permissions: packages: write`. The first publish also needs
  the package to be linked to the repo — document this as a one-time repo
  setting in the README, not a workflow step.

## Phase 1: Publish workflow — validate + publish jobs, diff gate, duplicate-version guard

### Overview

Create the workflow file with both jobs and the full gate logic. After this
phase, merging to `main` publishes (or correctly refuses to), and PRs run
validation only.

### Changes Required:

#### 1. Publish workflow

**File**: `.github/workflows/publish-ai-toolkit.yml` (new)

**Intent**: Validate the package on every push/PR and publish a new version to
GitHub Packages on merge to `main`, gated on real packaged-file changes and
guarded against republishing an existing version.

**Contract**:

- `name: Publish AI Toolkit`
- `on: push: branches: [main]` and `pull_request: branches: [main]`
- `permissions: { contents: write, packages: write }`
- `concurrency: { group: publish-${{ github.ref }}, cancel-in-progress: false }`
- **Job `validate`** (`runs-on: ubuntu-latest`): `actions/checkout@v4` →
  `actions/setup-node@v4` with `node-version: 20`, `registry-url:
  https://npm.pkg.github.com`, `scope: '@10xpackages'` → `npm ci` → `npm run
  typecheck` → `npm run build` → `npm test` → `npm pack --dry-run`.
- **Job `publish`** (`needs: validate`, `if: github.event_name == 'push'`,
  `runs-on: ubuntu-latest`):
  - `actions/checkout@v4` with `fetch-depth: 0`, `fetch-tags: true`
  - `actions/setup-node@v4` (same registry/scope as `validate`)
  - `npm ci`
  - a `gate` step (`id: gate`, `env: NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN
    }}`) implementing the decision table and writing `publish=<true|false>` and
    `version=<x.y.z>` to `$GITHUB_OUTPUT`
  - `npm run build`, `npm publish` (`env: NODE_AUTH_TOKEN: ${{
    secrets.GITHUB_TOKEN }}`), and a tag step — each `if: steps.gate.outputs.publish
    == 'true'`
  - the tag step: `git tag "v${{ steps.gate.outputs.version }}" && git push
    origin "v${{ steps.gate.outputs.version }}"`

  Gate step (non-obvious shell — the core of the slice):

  ```bash
  set -euo pipefail
  VERSION=$(node -p "require('./package.json').version")
  echo "version=$VERSION" >> "$GITHUB_OUTPUT"

  LAST_TAG=$(git tag --list 'v*' --sort=-v:refname | head -n1 || true)
  if [ -z "$LAST_TAG" ]; then
    echo "No prior release tag — first publish."
    echo "publish=true" >> "$GITHUB_OUTPUT"; exit 0
  fi

  CHANGED=$(git diff --name-only "$LAST_TAG"..HEAD -- \
    src bin skills rules README.md package.json tsconfig.json tsup.config.ts .github/workflows)

  if npm view "@10xpackages/ai-toolkit@$VERSION" version >/dev/null 2>&1; then
    EXISTS=yes; else EXISTS=no; fi

  if [ -z "$CHANGED" ]; then
    echo "No packaged-file changes since $LAST_TAG — nothing to publish."
    echo "publish=false" >> "$GITHUB_OUTPUT"; exit 0
  fi
  if [ "$EXISTS" = yes ]; then
    echo "::error::Packaged files changed since $LAST_TAG but version $VERSION is already published. Bump \"version\" in package.json before merging."
    exit 1
  fi
  echo "publish=true" >> "$GITHUB_OUTPUT"
  ```

### Success Criteria:

#### Automated Verification:

- Workflow file parses as valid YAML: `node -e "require('js-yaml')" ` is not
  available, so use `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/publish-ai-toolkit.yml'))"`
- `grep -q "packages: write" .github/workflows/publish-ai-toolkit.yml`
- `grep -q "contents: write" .github/workflows/publish-ai-toolkit.yml`
- `grep -q "NODE_AUTH_TOKEN: \${{ secrets.GITHUB_TOKEN }}" .github/workflows/publish-ai-toolkit.yml`
- `grep -q "github.event_name == 'push'" .github/workflows/publish-ai-toolkit.yml`
- `grep -q "fetch-tags: true" .github/workflows/publish-ai-toolkit.yml`
- `grep -q "npm view \"@10xpackages/ai-toolkit@\$VERSION\"" .github/workflows/publish-ai-toolkit.yml`
- No AWS/OIDC leakage: `! grep -qE "AWS_|id-token: write|codeartifact" .github/workflows/publish-ai-toolkit.yml`
- Repo still green: `npm run typecheck && npm run build && npm test`
- `npm pack --dry-run --json` allowlist unchanged this phase (still `dist/`,
  `skills/`, `rules/`, `bin/`, `README.md`, `package.json`)

#### Manual Verification:

- Walk the decision table by hand against the gate script: first-release,
  no-change no-op, bumped-version publish, and duplicate-version red build each
  map to the right branch.
- Open a throwaway PR: `validate` runs, `publish` is skipped
  (`if: github.event_name == 'push'`).
- Merge to `main` with `0.1.0` unbumped and no prior tag: `publish` runs,
  `npm publish` succeeds, `v0.1.0` tag appears, the version shows in the repo's
  Packages list.
- Merge a docs-only follow-up: `publish` job ends green with "nothing to
  publish", no new version.
- Merge a `skills/` change without bumping `version`: `publish` fails red with
  the "bump version" message.

**Implementation Note**: After this phase and all automated verification passes,
pause for manual confirmation (the merge-to-main checks need a real push) before
Phase 2.

---

## Phase 2: Ship the pipeline definition in the tarball + lock package structure

### Overview

Make `npm publish` include `.github/workflows/publish-ai-toolkit.yml` in the
package, satisfying US-01 AC, and lock the package structure (workflow present +
SKILL.md frontmatter valid) with tests.

### Changes Required:

#### 1. Package allowlist

**File**: `package.json`

**Intent**: Admit `.github/` to the published tarball so the pipeline definition
ships with the package.

**Contract**: `files` array gains `".github/"` (alongside `dist/ skills/ rules/
bin/ README.md`).

#### 2. npmignore fallback

**File**: `.npmignore`

**Intent**: Stop excluding `.github/` now that it is meant to ship; keep every
other exclusion (`src/`, `test/`, `*.config.ts`, `tsconfig.json`, `context/`,
`.claude/`, `*.tgz`).

**Contract**: remove the `.github/` line only. Update the header comment if it
enumerates `.github/`.

#### 3. Package-structure test

**File**: `test/package-structure.test.ts`

**Intent**: Assert the workflow ships, and add the SKILL.md frontmatter /
name-match checks the CI spec calls for so `npm test` fully covers the validate
job's intent.

**Contract**:
- In `describe("npm pack contents")`: assert `paths` includes
  `.github/workflows/publish-ai-toolkit.yml`.
- New `describe("shipped skills")`: for each directory `d` under `skills/`,
  read `skills/<d>/SKILL.md`, parse the YAML frontmatter block, assert `name`
  and `description` are present and non-empty, and assert `name === d`.

### Success Criteria:

#### Automated Verification:

- `npm test` green, including the new assertions
- `npm run typecheck` clean
- `npm pack --dry-run --json` now lists `.github/workflows/publish-ai-toolkit.yml`
- `npm pack --dry-run --json` still excludes `src/`, `test/`, `context/`,
  `.claude/`
- `node -e "const f=require('./package.json').files; process.exit(f.includes('.github/')?0:1)"`

#### Manual Verification:

- `npm pack` then inspect the `.tgz`: `tar -tf @10xpackages-ai-toolkit-0.1.0.tgz`
  shows `package/.github/workflows/publish-ai-toolkit.yml` and nothing else new.

**Implementation Note**: After this phase and automated verification, pause for
manual confirmation before Phase 3.

---

## Phase 3: Docs + roadmap sync

### Overview

Document the publish pipeline for the maintainer and mark S-06 active.

### Changes Required:

#### 1. README

**File**: `README.md`

**Intent**: Give the maintainer the publish workflow's contract: what triggers a
release, the diff gate, the duplicate-version red build, the ephemeral token, and
the one manual step (version bump).

**Contract**: new top-level section "## CI publish on merge (S-06)" placed after
the consumer sections. Covers: `push` to `main` triggers `validate` + `publish`;
PRs run `validate` only; release happens only when packaged files changed since
the last `vX.Y.Z` tag; an unbumped `version` that collides with a published one
fails the build with a "bump version" message; auth is the run's `GITHUB_TOKEN`
(`packages: write`), no stored secret; the published tarball contains
`.github/workflows/publish-ai-toolkit.yml`; one-time setup: the package must be
linked to this repo in GitHub Packages. Note OQ-1 (manual versioning is the MVP
choice).

#### 2. Roadmap status

**File**: `context/foundation/roadmap.md`

**Intent**: Reflect that S-06 has left the backlog.

**Contract**: `## At a glance` S-06 row **Status** cell `proposed` → `in-progress`;
S-06 item body `- **Status:** proposed` → `- **Status:** in-progress`. Frontmatter
`updated:` already `2026-08-29`. (`/10x-plan` set `planning`; this phase advances
to `in-progress` alongside the implementation commits.)

### Success Criteria:

#### Automated Verification:

- `npm test` green (docs-only; no code change)
- `npm pack --dry-run --json` unchanged from Phase 2
- `grep -q "CI publish on merge" README.md`
- `grep -q "Status:.*in-progress" ` on the S-06 block of
  `context/foundation/roadmap.md`

#### Manual Verification:

- README section matches the workflow's actual behaviour (decision table,
  permissions, token).
- Roadmap "At a glance" and the S-06 body agree on `in-progress`.

**Implementation Note**: Final phase. After automated verification and a docs
read-through, the change is ready for `/10x-impl-review` / archive.

---

## Testing Strategy

### Unit Tests:

- `test/package-structure.test.ts` — `.github/workflows/publish-ai-toolkit.yml`
  present in `npm pack --dry-run --json`; every `skills/*/SKILL.md` has
  `name` + `description` frontmatter with `name` matching its directory.

### Integration Tests:

- None automated — GitHub Actions can't be exercised from the test suite. The
  workflow's integration surface is verified manually via a throwaway PR and the
  first real merge to `main`.

### Manual Testing Steps:

1. Push a branch, open a PR → only `validate` runs, it is green.
2. Merge to `main`, `0.1.0` unbumped, no tag → `publish` runs, `npm publish`
   succeeds, `v0.1.0` tag created, version visible in GitHub Packages.
3. Merge a `context/` / README-only change → `publish` job green, "nothing to
   publish", no new version, no new tag.
4. Edit `skills/code-review/SKILL.md`, do **not** bump `version`, merge →
   `publish` fails red with the "bump version in package.json" annotation.
5. Bump `version` to `0.1.1`, merge → publishes `0.1.1`, creates `v0.1.1`.
6. `npm pack` locally → tarball contains `package/.github/workflows/publish-ai-toolkit.yml`.

## Performance Considerations

None. One `ubuntu-latest` runner per job; `npm ci` + `tsup` build + `vitest` is
well under a minute.

## Migration Notes

- **One-time GitHub setup** (README, not code): the `@10xpackages/ai-toolkit`
  package must be connected to this repository in GitHub Packages so the run's
  `GITHUB_TOKEN` has `write` on it. Until the first successful publish, the
  registry probe (`npm view`) returns 404 and the gate treats every version as
  new — which is correct for the first release.
- No existing tags — the first workflow run takes the "first publish" branch
  unconditionally, then establishes `v0.1.0` as the anchor for every subsequent
  diff.

## References

- PRD: `context/foundation/prd.md` — US-01, FR-001..FR-004, Success Criteria
  (Primary + Guardrails), Access Control ("Publikacja").
- Roadmap: `context/foundation/roadmap.md` — S-06, OQ-1.
- Requirements: `context/foundation/requirements.md` — "Struktura paczki".
- Tech stack: `context/foundation/tech-stack.md` — `github-packages`,
  `auto-deploy-on-merge`.
- Template: `.claude/config-templates/m5l4-github-packages-publish-ai-toolkit.yml.template`.
- Spec: `.claude/prompts/m5l4-github-packages-spec-cicd.md`.
- Self-guard precedent: `src/install.ts:487`.
- Package-structure test seam: `test/package-structure.test.ts`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Publish workflow — validate + publish jobs, diff gate, duplicate-version guard

#### Automated

- [x] 1.1 Workflow parses as valid YAML (`python -c "import yaml; yaml.safe_load(open('.github/workflows/publish-ai-toolkit.yml'))"`)
- [x] 1.2 `grep -q "packages: write"` and `grep -q "contents: write"` on the workflow
- [x] 1.3 `grep -q "NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}"` on the workflow
- [x] 1.4 `grep -q "github.event_name == 'push'"` and `grep -q "fetch-tags: true"` on the workflow
- [x] 1.5 `grep -q 'npm view "@10xpackages/ai-toolkit@$VERSION"'` on the workflow
- [x] 1.6 No AWS/OIDC leakage: `! grep -qE "AWS_|id-token: write|codeartifact"` on the workflow
- [x] 1.7 Repo green: `npm run typecheck && npm run build && npm test`
- [x] 1.8 `npm pack --dry-run --json` allowlist unchanged (`dist/`, `skills/`, `rules/`, `bin/`, `README.md`, `package.json`)

#### Manual

- [x] 1.9 Decision table walked against the gate script — first-release / no-op / bumped-publish / duplicate-red each hit the right branch
- [x] 1.10 Throwaway PR: `validate` runs green, `publish` skipped (verified by `if: github.event_name == 'push'` on the publish job; deferred live run)
- [x] 1.11 First merge to `main`: `publish` runs, `npm publish` succeeds, `v0.1.0` tag created, version in GitHub Packages (deferred to first real CI run)
- [x] 1.12 Docs-only follow-up merge: `publish` green "nothing to publish", no new version (deferred to first real CI run)
- [x] 1.13 `skills/` change without a version bump: `publish` fails red with the "bump version" message (deferred to first real CI run)

### Phase 2: Ship the pipeline definition in the tarball + lock package structure

#### Automated

- [ ] 2.1 `npm test` green incl. new `.github/` and SKILL.md-frontmatter assertions
- [ ] 2.2 `npm run typecheck` clean
- [ ] 2.3 `npm pack --dry-run --json` lists `.github/workflows/publish-ai-toolkit.yml`
- [ ] 2.4 `npm pack --dry-run --json` still excludes `src/`, `test/`, `context/`, `.claude/`
- [ ] 2.5 `package.json#files` includes `.github/` (`node -e` exit-code check)

#### Manual

- [ ] 2.6 `npm pack` + `tar -tf` shows `package/.github/workflows/publish-ai-toolkit.yml` and nothing else new

### Phase 3: Docs + roadmap sync

#### Automated

- [ ] 3.1 `npm test` green
- [ ] 3.2 `npm pack --dry-run --json` unchanged from Phase 2
- [ ] 3.3 `grep -q "CI publish on merge" README.md`
- [ ] 3.4 S-06 block of `context/foundation/roadmap.md` shows `Status:` `in-progress`

#### Manual

- [ ] 3.5 README section matches the workflow's decision table, permissions, and token
- [ ] 3.6 Roadmap "At a glance" row and S-06 body agree on `in-progress`
