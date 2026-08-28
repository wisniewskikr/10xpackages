# Package Skeleton (F-01) — Plan Brief

> Full plan: `context/changes/package-skeleton/plan.md`

## What & Why

Stand up the `@10xpackages/ai-toolkit` npm package skeleton — a scoped publishable
manifest, a TypeScript + tsup thin build, a Vitest harness, the conventional source
layout, and the internal payload structure (`skills/`, `rules/`) with **stubbed**
installer / uninstaller / CLI entrypoints. Without a skeleton no roadmap slice is
plannable — there is nothing to `npm init`. The first consumer slice (S-01) fills the
real reconcile logic into these stubs and is where that layer gets its real test.

## Starting Point

The repo has only `context/` foundation docs and `.claude/` (skills, prompts,
reference `m5l4-github-packages-*` templates). No `package.json`, no `src/`, no build,
no tests, no CI. Stack is already decided in `context/foundation/tech-stack.md`.

## Desired End State

`npm install` / `npm run build` / `npm run typecheck` / `npm test` all pass. `node
bin/ai-toolkit.js --help` prints usage for `install` / `uninstall` (both stubs that
print a "not yet implemented" notice and exit 0). `npm pack --dry-run` ships exactly
`dist/ skills/ rules/ bin/ README.md package.json` — no `src/`, `test/`, or `context/`.
`src/manifest.ts` exports the `ToolkitManifest` type and the sentinel marker constants
that S-01 / S-05 will import.

## Key Decisions Made

| Decision                       | Choice                                   | Why (1 sentence)                                                                 | Source   |
| ------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------- | -------- |
| Language / build / test        | TypeScript + tsup + Vitest              | Fixed by `tech-stack.md`; TS gives explicit contracts at manifest + sentinel boundaries. | Research |
| Package name / scope           | `@10xpackages/ai-toolkit`               | Scope must match the GitHub owner for GitHub Packages; maintainer confirms at S-06.     | Plan     |
| Phase count                    | 2 (tooling+stubs, then payload+tests)   | Phase 1 yields a compiling package; Phase 2 makes it verifiable and gives it content.   | Plan     |
| Installer logic in this change | None — stubs only                       | Roadmap F-01 explicitly scopes out reconcile logic; S-01 owns it.                       | Research |
| `bin` target                   | Committed `bin/ai-toolkit.js` shim      | Keeps `package.json#bin` / `postinstall` independent of the tsup output layout.         | Plan     |
| `postinstall` behaviour        | No-op + notice when not a nested dep    | `npm install` in this repo runs `postinstall`; it must stay green and non-fatal.        | Plan     |
| CI workflow                    | Excluded                                | S-06 (`ci-publish-on-merge`) owns publishing.                                            | Research |
| TS module resolution           | `moduleResolution: "Bundler"`           | tsup owns emit; avoids `tsc` demanding `.js` import extensions and failing typecheck.    | Plan     |
| Tarball packing                | Ship an `.npmignore`                    | Stops npm falling back to `.gitignore` and stripping git-ignored `dist/` from publish.   | Plan     |

## Scope

**In scope:** `package.json` (scoped, `publishConfig`, `files` whitelist, scripts,
`bin`, dev tooling); `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`;
`.gitignore`, `.npmrc` (registry mapping, no token), `README.md`; `src/manifest.ts`
(contracts), `src/install.ts` / `src/uninstall.ts` / `src/cli.ts` (stubs);
`bin/ai-toolkit.js`; `skills/code-review/SKILL.md`; `rules/CLAUDE.md`; Vitest suite.

**Out of scope:** real install/uninstall/reconcile logic, sentinel-block merge,
manifest writing, `.npmrc` line insertion, copy/`npx` mode, credential helper, CI
workflow, multi-tool profiles, `prompts/` & `config-templates/` payloads.

## Architecture / Approach

`src/*.ts` → tsup → `dist/*.js` (CJS, Node20). `package.json#bin` and `postinstall`
call `bin/ai-toolkit.js`, a one-line shim that `require`s `dist/cli.js`. `cli.ts`
dispatches `argv[2]` to `runInstall` / `runUninstall` stubs or prints usage.
`src/manifest.ts` holds the only real contract: `ToolkitManifest` type +
`SENTINEL_BEGIN` / `SENTINEL_END`. Tests lock those contracts, the no-throw stub
behaviour, and the `npm pack` file list.

## Phases at a Glance

| Phase                              | What it delivers                                              | Key risk                                                        |
| ---------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| 1. Manifest, tooling, entry stubs  | Compiling, installable package; `build` / `typecheck` green | `postinstall` failing local `npm install`; tsup shebang wiring |
| 2. Package payload + test harness  | `skills/` + `rules/` payload; Vitest suite green            | `npm pack` file-list assertion brittle to output-path changes  |

**Prerequisites:** none (roadmap F-01, no dependencies).
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- `@10xpackages` scope is a working assumption; real GitHub org/owner confirmed at S-06.
- `PACKAGE_VERSION` in `src/manifest.ts` is hand-synced with `package.json` in MVP
  (OQ-1 covers automating version management); a test asserts they match.
- A repo-level PostToolUse hook invokes a non-existent Maven wrapper (`./mvnw`) — it is
  a stray config for this non-Java repo and does not affect the plan.

## Success Criteria (Summary)

- `npm install`, `npm run build`, `npm run typecheck`, `npm test` all pass from a clean checkout.
- `npm pack --dry-run` ships the payload + `dist/` + `bin/` + `README.md` and nothing else.
- `src/manifest.ts` exposes the manifest type and sentinel constants S-01 can import unchanged.
