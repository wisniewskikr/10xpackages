# Registry Round Trip (S-07) — Plan Brief

> Full plan: `context/changes/registry-round-trip/plan.md`

## What & Why

Prove the publish→consume loop closes and document the consumer-CI half of it.
S-06 makes "merge to `main`" publish a new `@10xpackages/ai-toolkit` version to
the org's private GitHub Packages registry; S-01–S-05 make a consumer `npm
install` reconcile skills, the rules block, the `.npmrc` line and the manifest.
Nothing yet proves the two halves meet on a **real packed artifact installed the
way a consumer installs it**, and nothing documents what a consumer repo commits
and runs in its own CI to pull a published version with a short-lived credential.
This is the roadmap's loop-closer (S-07) — the first place the publishing and
consuming sides meet.

## Starting Point

Publisher half done: `.github/workflows/publish-ai-toolkit.yml` (diff gate +
duplicate-version guard, `secrets.GITHUB_TOKEN` auth). Consumer half done:
`src/install.ts#runInstall()` links skills, splices the sentinel-fenced rules
block, `ensureLine`s the `.npmrc` mapping line, conditionally writes
`//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` only when that env var is
set, and writes the manifest — never throwing out of `postinstall`. But every
test calls `runInstall()` directly against `src/` with `PROJECT_ROOT` set, or
shells `npm pack --dry-run` to inspect the allowlist. No test installs the
**built, packed** tarball and lets npm run the real `postinstall`. README
"Consumer setup" is developer-machine only — no consumer-CI guidance. Roadmap
S-07 is `proposed`.

## Desired End State

`test/round-trip.test.ts` packs the real tarball and `npm install`s it into a
throwaway consumer project, asserting the full consumer contract (skill entry
resolves to the payload; rules block fenced in `CLAUDE.md`; five-field manifest
matching the package; `.npmrc` mapping line exactly once; no credential line
without the env var, the literal `${NODE_AUTH_TOKEN}` reference with it) and a
byte-identical second run. `examples/consumer-ci.yml` is a paste-ready consumer
GitHub Actions workflow (kept out of the tarball). README gains a "Consumer CI —
registry round trip" section covering the opt-in mapping line, the ephemeral
`GITHUB_TOKEN` flow, the fetch-auth-vs-installer-auth ordering, and the one-time
package→repo read-access setting. Roadmap S-07 → `in-progress`.

## Key Decisions Made

All decisions taken autonomously under the `/goal` human-out-of-loop directive,
grounded in the roadmap, PRD, S-06 hand-off, and the frozen S-01 contracts.

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| How to "prove the round trip" | Integration test that packs the tarball + `npm install`s it into a temp consumer project | The real `postinstall` + `node_modules` walk is untested; the live private registry is unreachable from CI tests | Plan |
| Live registry pull | Out of scope — network leg covered by docs + the S-06 workflow | Private registry + credentials not reachable from the test suite; PRD Non-Goals bars standing up infra | PRD / Plan |
| Consumer CI workflow | Ship `examples/consumer-ci.yml` in the **source repo only**, not the tarball | Consumers have read access to the source repo; a second workflow in the tarball would try to run in this repo | Plan |
| `src/` changes | None — test + docs/config only | S-06 hand-off scoped consumer-side CI here with no installer change; installer contract is frozen | Roadmap / S-06 plan |
| Keep the test network-free | `npm install --prefer-offline --no-audit --no-fund`; fail loudly if a sandbox blocks npm | Package has zero runtime deps — resolves purely from the tarball | Plan |
| Fetch auth in consumer CI | `actions/setup-node` `registry-url`+`scope` provides it; the installer's conditional `${NODE_AUTH_TOKEN}` line runs *after* the fetch | Otherwise a reader assumes the installer bootstraps its own fetch auth | Plan |
| Phase count | 3, one commit each (test / example+docs / roadmap+context) | Mirrors the S-06 change's cadence | Plan |

## Scope

**In scope:**
- `test/round-trip.test.ts` — pack + install-into-temp-consumer, contract +
  idempotency assertions, both `NODE_AUTH_TOKEN` states.
- `examples/consumer-ci.yml` — paste-ready consumer workflow.
- `.npmignore` + `test/package-structure.test.ts` — keep and lock `examples/`
  out of the tarball.
- README "Consumer CI — registry round trip" section; README "Context" list;
  roadmap S-07 → `in-progress`.

**Out of scope:**
- Live registry authentication / pull; any `src/` behaviour change; a committed
  consumer repo or `consumer/` fixture; shipping the consumer workflow in the
  tarball; OIDC / AWS / CodeArtifact; automated versioning (OQ-1); multi-tool
  profiles (OQ-2); Windows-shell auth-line resolution (OQ-4 stays open);
  `master` support; Release objects / changelog.

## Architecture / Approach

One new integration test drives the real artifact: `beforeAll` builds
(defensively) and `npm pack --pack-destination`s once; each case `mkdtemp`s a
consumer root, writes a fixture `package.json` + `.npmrc` mapping line, runs
`npm install <tarball>` with a controlled `env`, and asserts the reconcile
output plus a byte-identical re-run. Docs + a source-only example workflow cover
the network leg the test can't reach. No runtime code moves.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Round-trip integration test | `test/round-trip.test.ts` — packs + installs the tarball into a temp consumer, asserts the contract + idempotency | `npm install` in a test: cold-start time, sandbox network policy, Windows junction assertions; stale `dist/` if run outside `npm test` |
| 2. Consumer CI example + docs | `examples/consumer-ci.yml`; `.npmignore` + package-structure test keep it out of the tarball; README "Consumer CI" section | Doc drift from real installer behaviour; misstating the cross-repo `GITHUB_TOKEN` read-access requirement |
| 3. Roadmap + README context sync | Roadmap S-07 → `in-progress`; README "Context" lists `registry-round-trip/` | Trivial; forward-only status edit |

**Prerequisites:** S-06 (publisher CI) and S-01 (installer reconcile) — both
functionally complete. `npm` on `PATH` in the test environment (already assumed
by `test/package-structure.test.ts`). One-time GitHub setting (docs only): the
private package grants the consumer repo read access.
**Estimated effort:** ~1 session across 3 phases; Phase 1 is the bulk.

## Open Risks & Assumptions

- `npm install <tarball>` must run offline-ish in the test environment — assumed
  OK since the package has no runtime deps; if blocked, the test fails loudly
  rather than skipping.
- The round trip is proven against the packed artifact, **not** a live registry
  pull — the network/auth leg rests on documentation + the S-06 workflow.
- Cross-repo private-package read with `secrets.GITHUB_TOKEN` needs the package's
  "Manage Actions access" to list the consumer repo — documented, not enforced
  by code.
- OQ-4 (clean-Windows shell auth line) stays open; the round-trip test's Windows
  run is a partial spot check (junction path only).

## Success Criteria (Summary)

- `npm test` runs a round-trip case that packs the real tarball, installs it as a
  consumer would, and confirms skills + rules block + manifest + `.npmrc`
  mapping line land — with no credential value ever written and a diff-free
  second run.
- A consumer repo can follow `examples/consumer-ci.yml` + the README section to a
  working CI pull of a published version using only an ephemeral `GITHUB_TOKEN`.
- The published tarball still excludes `examples/`, locked by a test.
