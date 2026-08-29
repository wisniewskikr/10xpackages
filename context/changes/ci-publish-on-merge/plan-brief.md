# CI publish on merge (S-06) — Plan Brief

> Full plan: `context/changes/ci-publish-on-merge/plan.md`

## What & Why

Add one GitHub Actions workflow so that merging an artifact change to `main`
publishes a new version of `@10xpackages/ai-toolkit` to the org's private GitHub
Packages registry, in a single CI run, with no stored secret. A merge only
produces a release when the files that go into the tarball actually changed since
the last release (diff gate), and an attempt to publish a version that already
exists fails the build loudly instead of passing silently.

## Starting Point

No `.github/` in the repo — this is the first CI. A vendored template
(`.claude/config-templates/m5l4-github-packages-publish-ai-toolkit.yml.template`)
gives the two-job validate/publish skeleton but has neither the diff gate nor the
duplicate-version check. `package.json#files` is an allowlist that excludes
`.github/`; `.npmignore` also lists it. No git tags exist. Version is a manual
`package.json#version` bump.

## Desired End State

`.github/workflows/publish-ai-toolkit.yml` runs `validate` (typecheck, build,
test, `npm pack --dry-run`) on every push and PR, and `publish` only on push to
`main`. The publish job diffs packaged-content paths across `"$LAST_TAG"..HEAD`,
probes the registry for `package.json#version`, and either publishes + tags
`vX.Y.Z`, ends green as a no-op, or fails red telling the maintainer to bump the
version. Auth is the run's `GITHUB_TOKEN` (`packages: write`). The published
tarball now contains the workflow file, locked by a package-structure test.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Diff-gate anchor | Newest `v*` git tag; publish job pushes `vX.Y.Z` after publishing; first release (no tag) publishes unconditionally | Git-native, matches the lesson's "między ostatnim tagiem a teraz", no extra state store | Plan |
| Duplicate version | Explicit `npm view @…@$VERSION` probe: changed + already published → red build; published + unchanged → green no-op; `npm publish` 409 as backstop | Satisfies FR-004 (loud) and FR-003 (diff gate) together | Plan |
| Ship workflow in tarball | Add `.github/` to `files`, drop it from `.npmignore`, lock with a test | US-01 AC and `requirements.md` package tree require the pipeline definition in the published package | Plan |
| Triggers | `push: [main]` + `pull_request:` (validate only); no tag/Release trigger | PRD FR-003 Socrates note rejects tag triggers as an extra manual step | Plan |
| Auth / permissions | `secrets.GITHUB_TOKEN` → `NODE_AUTH_TOKEN`; `contents: write` (tag) + `packages: write`; `concurrency` per ref | PRD Access Control: ephemeral credential, no stored secret | Plan |
| Versioning | Stays manual `package.json#version` | OQ-1 defers automated semantic versioning past MVP | PRD / Roadmap |

## Scope

**In scope:**
- `.github/workflows/publish-ai-toolkit.yml` — validate + publish jobs, diff
  gate, duplicate-version red build, ephemeral token, auto-tag.
- `package.json` / `.npmignore` — ship `.github/` in the tarball.
- `test/package-structure.test.ts` — assert the workflow ships + SKILL.md
  frontmatter/name-match.
- README "CI publish on merge" section; roadmap S-06 → `in-progress`.

**Out of scope:**
- Automated / semantic versioning (OQ-1).
- Consumer-side CI auth and registry round-trip (S-07).
- OIDC / AWS / CodeArtifact (wrong model).
- Any `src/` behaviour change; `master` branch support; GitHub Release objects /
  changelogs.

## Architecture / Approach

Single workflow file. `validate` reuses the repo's existing quality gates so CI
and local `npm` scripts stay identical. `publish` (`needs: validate`, `if: push`)
checks out full history + tags (`fetch-depth: 0`, `fetch-tags: true`), runs one
shell `gate` step that resolves the version, finds the newest `v*` tag, diffs
`src bin skills rules README.md package.json tsconfig.json tsup.config.ts
.github/workflows` across `"$TAG"..HEAD`, probes the registry, and writes
`publish=<bool>` to `$GITHUB_OUTPUT`. Publish/tag steps are gated on that output.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Publish workflow | The workflow file with both jobs, diff gate, duplicate-version guard, auto-tag | GitHub Actions can't be tested locally; gate branch logic must match the decision table exactly; shallow checkout would break the gate silently |
| 2. Ship pipeline in tarball | `.github/` in `files`, out of `.npmignore`, locked by a `package-structure.test.ts` assertion + SKILL.md frontmatter checks | Allowlist + `.npmignore` interaction; accidental over-inclusion of `.github/` contents |
| 3. Docs + roadmap | README "CI publish on merge" section; roadmap S-06 → `in-progress` | Doc drift from the workflow's real behaviour |

**Prerequisites:** F-01 (package skeleton) — done. One-time GitHub setting:
package linked to this repo in GitHub Packages (README note, not code).
**Estimated effort:** ~1 session across 3 phases; Phase 1 is the bulk.

## Open Risks & Assumptions

- The `gate` step can't be exercised by the test suite — correctness rests on the
  manual decision-table walk plus the first real merge to `main`.
- `GITHUB_TOKEN` with `packages: write` can publish this scope once the package
  is linked to the repo; the very first publish predates any linkage and relies
  on GitHub creating the link on first push.
- `npm view` against GitHub Packages returns a clean non-zero for an
  unpublished version (assumed; the gate treats any non-zero as "not published").
- Manual version bumping will eventually cause a duplicate-version red build —
  that is the designed FR-004 behaviour, not a defect (OQ-1 tracks the fix).

## Success Criteria (Summary)

- Merging a real artifact change with a bumped `version` to `main` publishes that
  version to GitHub Packages in one run, with no stored secret.
- Merging a change that doesn't touch packaged files produces no release.
- Merging changed packaged files without a version bump fails the build with an
  actionable message.
- `npm pack` includes `.github/workflows/publish-ai-toolkit.yml`.
