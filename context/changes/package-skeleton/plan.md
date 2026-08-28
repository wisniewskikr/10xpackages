# Package Skeleton (F-01) Implementation Plan

## Overview

Scaffold the `@10xpackages/ai-toolkit` npm package: a scoped, publishable manifest, a
TypeScript + tsup thin build, a Vitest test harness, the conventional source layout, and
the internal package payload structure (`skills/`, `rules/`) plus **stubbed** installer /
uninstaller / CLI entrypoints. This is the foundation every other roadmap item builds on —
S-01 fills the real reconcile logic into the stubs; S-06 publishes this structure via CI.
No install/reconcile/sentinel-merge behaviour is implemented here.

## Current State Analysis

- The repo has **no `package.json`, no `src/`, no `.github/workflows/`** — only the
  `context/` foundation docs, `.claude/` (skills, prompts, config-templates), and the
  lesson source `m5l4-shared-ai-registry-skille-komendy-i-reguly-dla-zespolu.md`.
- `context/foundation/tech-stack.md` fixes the stack: **npm**, **TypeScript** (explicit
  contracts at the manifest + sentinel-marker boundaries), **tsup** thin build, **Vitest**
  for idempotency / marker-guard tests, conventional layout `src/ bin/ dist/ test/`,
  Node `>=20`, `starter_id: none` (hand-rolled `npm init`, no generator).
- `context/foundation/roadmap.md` → **F-01 `package-skeleton`**, `Status: ready`,
  Prerequisites: none. Explicitly scoped to skeleton only: "stubowane wejścia
  instalatora i deinstalatora, nie logika instalatora".
- `.claude/config-templates/m5l4-github-packages-*.template` provide reference
  CommonJS installer/uninstaller/`package.json`/workflow/`.npmrc`. They are **material
  to adapt, not to copy 1:1** (lesson §"Zadanie praktyczne"). Key transfer: sentinel
  markers `<!-- BEGIN @scope/pkg -->` / `<!-- END @scope/pkg -->`, manifest at
  `.claude/.ai-toolkit-manifest.json` with `{package, version, tool, files[]}`,
  `postinstall` runs the installer, `files` whitelist limits the published tarball.
- `.claude/prompts/m5l4-shared-conventions.md` is the documented source for the sample
  `code-review` skill payload; `m5l4-github-packages-spec-pack.md` fixes package
  metadata (`@twoj-zespol/ai-toolkit` → we substitute `@10xpackages/ai-toolkit`).

## Desired End State

After this plan:

- `npm install` in this repo installs `typescript`, `tsup`, `vitest`, `@types/node`
  and completes without error (the `postinstall` stub no-ops when not running as a
  nested dependency).
- `npm run build` emits `dist/install.js`, `dist/uninstall.js`, `dist/cli.js` (CJS,
  Node20 target, shebang on `cli.js`).
- `npm run typecheck` passes under `strict`.
- `npm test` runs the Vitest suite green.
- `node bin/ai-toolkit.js --help` prints usage listing `install` and `uninstall`.
- `npm pack --dry-run` produces a tarball containing exactly `dist/`, `skills/`,
  `rules/`, `bin/`, `README.md`, `package.json` — and **not** `src/`, `test/`,
  `context/`, `.claude/`.
- The package payload exists: `skills/code-review/SKILL.md` and `rules/CLAUDE.md`.
- `src/manifest.ts` exports the `ToolkitManifest` contract type and the
  `SENTINEL_BEGIN` / `SENTINEL_END` constants that S-01 / S-05 will consume.

### Key Discoveries:

- Stack + layout are pre-decided in `context/foundation/tech-stack.md:1-25` — no stack
  choice to make here, only wiring.
- Reference installer `applyRulesBlock` / sentinel logic lives in
  `.claude/config-templates/m5l4-github-packages-install.js.template:52-73` — **do not
  port it**; only lift the marker string format into `src/manifest.ts` as constants.
- Manifest shape from `.claude/config-templates/m5l4-github-packages-install.js.template:80-89`
  → `{package, version, installedAt, files}`; PRD FR-009 adds **`tool`** ("narzędzie
  docelowe"). Encode `tool: "claude-code"` in the type.
- `postinstall` runs on `npm install` **inside this repo too** — the stub must detect
  "not inside `node_modules`" and no-op, mirroring `findProjectRoot`'s walk-up at
  `m5l4-github-packages-install.js.template:12-21`.
- Package name scope `@10xpackages` must match the GitHub org/owner for GitHub Packages
  to accept the publish; treated as the working value, maintainer confirms at S-06.

## What We're NOT Doing

- No real installer / uninstaller logic: no file copying, no symlinks, no `.npmrc`
  line insertion, no sentinel-block merge, no manifest **writing**, no reconcile /
  withdrawn-artifact removal. All of that is S-01 / S-02 / S-03 / S-05.
- No CI workflow (`.github/workflows/publish-ai-toolkit.yml`) — that is S-06.
- No consumer-side `.npmrc` auth flow, no `preinstall` credential helper — S-01 / S-06.
- No copy-mode / `npx` entrypoint behaviour — S-04 (the `cli.js` stub only prints usage).
- No multi-tool profiles (Cursor / Codex), no `prompts/` or `config-templates/` payload
  folders — PRD Non-Goals.
- No real content authoring for the sample skill/rules beyond a minimal valid stub
  derived from `m5l4-shared-conventions.md`.

## Implementation Approach

Two phases, each committed separately:

1. **Phase 1 — manifest, tooling, entry stubs.** Everything needed for `npm install` /
   `build` / `typecheck` to pass: `package.json`, `tsconfig.json`, `tsup.config.ts`,
   `vitest.config.ts`, `.gitignore`, `.npmrc`, `README.md`, `src/` (manifest contract +
   three stub entrypoints), `bin/ai-toolkit.js` shim.
2. **Phase 2 — package payload + test harness.** `skills/code-review/SKILL.md`,
   `rules/CLAUDE.md`, and the Vitest suite that locks the skeleton's contracts
   (sentinel constants, stub entrypoints don't throw, `files` whitelist, payload
   files present, `npm pack` contents).

Phase 1 delivers a compiling package; Phase 2 makes it verifiable and gives it content.

## Critical Implementation Details

- **`postinstall` lifecycle** — `npm install` in this repo triggers `postinstall`. The
  `cli.js` / `install.ts` stub must exit 0 and print a one-line "skeleton — not yet
  implemented" notice when `__dirname` is not under a `node_modules/`, so local dev
  installs stay quiet and green. tsup must emit a `#!/usr/bin/env node` shebang for
  `cli.js` (via `banner` or a `bin/` shim that `require`s `dist/cli.js`; the plan uses
  the shim so the `package.json#bin` target is build-layout-independent).
- **`files` whitelist is the publish contract** — Phase 2's `npm pack --dry-run` test is
  the guardrail against shipping `src/`, `test/`, or `context/`. If tsup output path
  changes, that test and `package.json#files` move together. Note the npm packing rule:
  with a `files` allowlist and **no** `.npmignore`, npm falls back to `.gitignore` for
  exclusions — so `dist/` (git-ignored) would be dropped from the tarball. Phase 1 ships
  an `.npmignore` to stop that fallback; the Phase 2 test asserts `dist/cli.js` is packed.

## Phase 1: Manifest, tooling, and entry stubs

### Overview

Stand up a compiling, installable npm package with the TypeScript/tsup/Vitest toolchain
and stub entrypoints. No payload, no tests yet.

### Changes Required:

#### 1. Package manifest

**File**: `package.json`

**Intent**: Define the scoped publishable package, its published-file whitelist, the
build/test/typecheck scripts, the `postinstall` hook, the `bin` command, and dev
tooling. Privacy comes from the GitHub Packages registry ACL, so `private` is omitted
(a `true` value would block `npm publish`).

**Contract**:
- `name` `@10xpackages/ai-toolkit`, `version` `0.1.0`, `license` `UNLICENSED`,
  `type` `commonjs`, `engines.node` `>=20`.
- `publishConfig.registry` = `https://npm.pkg.github.com`.
- `files`: `["dist/", "skills/", "rules/", "bin/", "README.md"]`.
- `bin`: `{ "ai-toolkit": "bin/ai-toolkit.js" }`.
- `scripts`: `build` = `tsup`, `typecheck` = `tsc --noEmit`, `test` = `vitest run`,
  `pretest` = `npm run build`, `prepublishOnly` = `npm run build`,
  `postinstall` = `node bin/ai-toolkit.js install`.
- `devDependencies`: `typescript`, `tsup`, `vitest`, `@types/node` (pin to current
  major ranges).

#### 2. TypeScript config

**File**: `tsconfig.json`

**Intent**: Strict typing for the `src/` contracts, Node20 / NodeNext resolution, no
emit (tsup owns emit).

**Contract**: `compilerOptions`: `strict: true`, `target: "ES2022"`,
`module: "ESNext"`, `moduleResolution: "Bundler"`, `noEmit: true`,
`esModuleInterop: true`, `skipLibCheck: true`, `types: ["node"]`. `include: ["src", "test"]`.

`moduleResolution: "Bundler"` (not `"NodeNext"`) because tsup/esbuild owns emit — this
avoids `tsc` requiring explicit `.js` extensions on the relative imports in `src/cli.ts`
(`./install`, `./uninstall`, `./manifest`), which would otherwise fail the typecheck step.

#### 3. Build config

**File**: `tsup.config.ts`

**Intent**: Thin CJS build of the three entrypoints to `dist/`, Node20 target, shebang
preserved on the CLI.

**Contract**: `entry: ["src/install.ts", "src/uninstall.ts", "src/cli.ts"]`,
`format: ["cjs"]`, `target: "node20"`, `outDir: "dist"`, `clean: true`,
`sourcemap: false`, `dts: false`.

#### 4. Test runner config

**File**: `vitest.config.ts`

**Intent**: Run `test/**/*.test.ts` in a node environment.

**Contract**: `test.environment: "node"`, `test.include: ["test/**/*.test.ts"]`.

#### 5. Manifest & sentinel contract

**File**: `src/manifest.ts`

**Intent**: Single source of truth for the installer's boundary contracts that S-01 /
S-05 will import — the manifest JSON shape and the rules-file sentinel marker strings.
No behaviour.

**Contract**:
- `export const PACKAGE_NAME = "@10xpackages/ai-toolkit"`.
- `export const PACKAGE_VERSION = "0.1.0"` (kept in sync with `package.json` by hand
  in MVP — OQ-1 covers automating this).
- `export const SENTINEL_BEGIN = \`<!-- BEGIN ${PACKAGE_NAME} -->\``,
  `export const SENTINEL_END = \`<!-- END ${PACKAGE_NAME} -->\``.
- `export interface ToolkitManifest { package: string; version: string;
  tool: "claude-code"; installedAt: string; files: string[]; }`.

#### 6. Installer entry stub

**File**: `src/install.ts`

**Intent**: Placeholder installer entrypoint. Detects whether it is running as a nested
dependency (walk `__dirname` up to a `node_modules/`); if not, prints a one-line
"skeleton, not yet implemented (see S-01)" notice and returns. Never throws, always
resolves — an exception here must not fail a consumer's `npm install`.

**Contract**: `export async function runInstall(): Promise<void>`. Wraps its body in
try/catch and downgrades any error to `console.warn`. Exported for tests; also invoked
by `cli.ts`.

#### 7. Uninstaller entry stub

**File**: `src/uninstall.ts`

**Intent**: Placeholder uninstaller entrypoint, same no-throw contract as the installer.

**Contract**: `export async function runUninstall(): Promise<void>`. Prints a
"not yet implemented (see S-03)" notice, returns.

#### 8. CLI dispatch stub

**File**: `src/cli.ts`

**Intent**: Executable entry that maps `argv[2]` to `runInstall` / `runUninstall` and
prints usage for `--help`, no arg, or an unknown subcommand. This is what `postinstall`
and the `bin` command invoke.

**Contract**: Shebang `#!/usr/bin/env node` as the first line. Recognises
`install`, `uninstall`, `--help` / `-h`. Usage text names the package and both
subcommands. Unknown subcommand → print usage, exit 0 (skeleton is non-fatal).

#### 9. Bin shim

**File**: `bin/ai-toolkit.js`

**Intent**: Stable, build-layout-independent executable target for `package.json#bin`
and `postinstall`; delegates to the compiled CLI.

**Contract**: `#!/usr/bin/env node` then `require("../dist/cli.js");`. Committed
(not built). If `dist/` is absent (e.g. `postinstall` before `prepublishOnly` in a
broken install) it must fail soft — wrap the `require` in try/catch → `console.warn`.

#### 10. Repo hygiene files

**Files**: `.gitignore`, `.npmignore`, `.npmrc`, `README.md`

**Intent**: `.gitignore` excludes `node_modules/` and `dist/`. `.npmignore` must exist so
npm stops consulting `.gitignore` when building the tarball — otherwise `dist/` (ignored
in git, but listed in `files` and required by the published package + S-06) gets stripped
from the publish. `.npmrc` records the scope→registry mapping for the source-of-truth
repo. `README.md` is a short package description (also shipped in the tarball per `files`).

**Contract**:
- `.gitignore`: `node_modules/`, `dist/`, `*.log`.
- `.npmignore`: dev-only paths — `src/`, `test/`, `*.config.ts`, `tsconfig.json`,
  `context/`, `.claude/`, `.github/`. The `files` allowlist is the primary control; this
  file's job is to neutralise the `.gitignore` fallback so `dist/` survives packing.
- `.npmrc`: single line `@10xpackages:registry=https://npm.pkg.github.com` (no token).
- `README.md`: name, one-paragraph purpose, "install / uninstall are stubs until S-01"
  note, pointer to `context/foundation/`.

### Success Criteria:

#### Automated Verification:

- Dependencies install: `npm install`
- Build emits the three entrypoints: `npm run build && node -e "require('fs').accessSync('dist/cli.js')"`
- Type checking passes: `npm run typecheck`
- CLI help works: `node bin/ai-toolkit.js --help` exits 0 and output contains `install` and `uninstall`
- `postinstall` stub is non-fatal: re-running `npm install` completes without error

#### Manual Verification:

- `git status` after `npm install` shows no unexpected tracked-file changes (dist/ ignored)
- Package name scope `@10xpackages` is acceptable to the maintainer for GitHub Packages, or flagged for change at S-06

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Package payload and test harness

### Overview

Add the shippable artifact payload (`skills/`, `rules/`) and the Vitest suite that
locks the skeleton's contracts so S-01 can build on a verified base.

### Changes Required:

#### 1. Sample skill payload

**File**: `skills/code-review/SKILL.md`

**Intent**: Minimal valid sample skill so the package ships non-empty `skills/` and
downstream installer tests have a real file tree to place. Content adapted (not copied)
from `.claude/prompts/m5l4-shared-conventions.md`.

**Contract**: Front-matter with `name: code-review` and a `description`, followed by a
short review checklist (naming, error handling, TypeScript, functions, security,
testing sections condensed). One skill dir, one `SKILL.md`.

#### 2. Team rules payload

**File**: `rules/CLAUDE.md`

**Intent**: The team rules block the installer will later inject between sentinels.
Skeleton ships it as plain content — no markers in the file itself.

**Contract**: A handful of concise team rules (headings + bullets). Must **not** contain
the `SENTINEL_BEGIN` / `SENTINEL_END` strings (that guard is S-05, but the payload
should be clean from the start).

#### 3. Contract tests

**File**: `test/manifest.test.ts`

**Intent**: Lock the boundary contracts other changes depend on.

**Contract**: Assert `SENTINEL_BEGIN` / `SENTINEL_END` both contain `PACKAGE_NAME` and
are distinct; assert a literal `ToolkitManifest` value type-checks and round-trips
through `JSON.stringify`/`parse`; assert `PACKAGE_VERSION` equals `package.json`'s
`version`.

#### 4. Entrypoint tests

**File**: `test/entrypoints.test.ts`

**Intent**: Guarantee the stubs are import-safe and non-throwing.

**Contract**: `await expect(runInstall()).resolves.toBeUndefined()` and same for
`runUninstall()`; both run without throwing when `PROJECT_ROOT` is unset and when set
to a temp dir.

#### 5. Package-structure tests

**File**: `test/package-structure.test.ts`

**Intent**: Lock the publish contract and payload presence.

**Contract**:
- `package.json#files` includes `dist/`, `skills/`, `rules/`, `bin/`, `README.md`.
- `skills/code-review/SKILL.md` and `rules/CLAUDE.md` exist and are non-empty.
- `execSync("npm pack --dry-run --json")` output lists `skills/code-review/SKILL.md`,
  `rules/CLAUDE.md`, and `dist/cli.js` (the `pretest` build guarantees `dist/` exists),
  and does **not** list any `src/`, `test/`, or `context/` path. The `dist/` assertion is
  the regression guard for the `.gitignore`/`.npmignore` packing interaction.

### Success Criteria:

#### Automated Verification:

- Test suite passes: `npm test`
- Build still green: `npm run build`
- Type check still green (test files included): `npm run typecheck`
- Tarball contents correct: `npm pack --dry-run` lists `skills/`, `rules/`, `dist/`, `bin/`, `README.md` and excludes `src/`, `test/`, `context/`

#### Manual Verification:

- Sample `SKILL.md` and `rules/CLAUDE.md` read as sensible starting content, not lorem ipsum
- Nothing in the payload accidentally contains the sentinel marker strings

**Implementation Note**: After this phase and all automated verification passes, the skeleton is complete — S-01 (`consumer-install-symlink`) is unblocked.

---

## Testing Strategy

### Unit Tests:

- Sentinel constants well-formed and distinct (`test/manifest.test.ts`)
- `ToolkitManifest` shape round-trips through JSON (`test/manifest.test.ts`)
- `PACKAGE_VERSION` matches `package.json#version` (drift guard)
- Stub entrypoints resolve without throwing, with and without `PROJECT_ROOT` (`test/entrypoints.test.ts`)

### Integration Tests:

- `npm pack --dry-run --json` tarball manifest contains the payload and excludes source/tests/context (`test/package-structure.test.ts`)

### Manual Testing Steps:

1. `npm install` → completes clean, no error from `postinstall`
2. `npm run build` → `dist/install.js`, `dist/uninstall.js`, `dist/cli.js` present
3. `node bin/ai-toolkit.js --help` → usage text with both subcommands
4. `node bin/ai-toolkit.js install` → prints the "not yet implemented" notice, exits 0
5. `npm test` → all green
6. `npm pack --dry-run` → inspect file list

## Performance Considerations

None. Build and test run in seconds; the skeleton has no runtime hot path.

## Migration Notes

Greenfield — no existing package or data to migrate. The `.claude/config-templates/`
reference templates are left untouched (they are lesson material, not package source).

## References

- Roadmap item: `context/foundation/roadmap.md` → F-01 `package-skeleton`
- Stack decision: `context/foundation/tech-stack.md`
- PRD: `context/foundation/prd.md` (FR-001, FR-009, Success Criteria "struktura paczki")
- Requirements: `context/foundation/requirements.md` ("Struktura paczki")
- Reference installer: `.claude/config-templates/m5l4-github-packages-install.js.template`
- Reference uninstaller: `.claude/config-templates/m5l4-github-packages-uninstall.js.template`
- Reference manifest: `.claude/config-templates/m5l4-github-packages-package.json.template`
- Pack spec: `.claude/prompts/m5l4-github-packages-spec-pack.md`
- Conventions source for sample skill: `.claude/prompts/m5l4-shared-conventions.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Manifest, tooling, and entry stubs

#### Automated

- [x] 1.1 Dependencies install: `npm install` — ddaba39
- [x] 1.2 Build emits the three entrypoints: `npm run build && node -e "require('fs').accessSync('dist/cli.js')"` — ddaba39
- [x] 1.3 Type checking passes: `npm run typecheck` — ddaba39
- [x] 1.4 CLI help works: `node bin/ai-toolkit.js --help` exits 0 and lists `install` and `uninstall` — ddaba39
- [x] 1.5 `postinstall` stub is non-fatal: re-running `npm install` completes without error — ddaba39

#### Manual

- [x] 1.6 `git status` after `npm install` shows no unexpected tracked-file changes — ddaba39
- [x] 1.7 Package name scope `@10xpackages` accepted by maintainer or flagged for S-06 — ddaba39

### Phase 2: Package payload and test harness

#### Automated

- [x] 2.1 Test suite passes: `npm test`
- [x] 2.2 Build still green: `npm run build`
- [x] 2.3 Type check still green with test files included: `npm run typecheck`
- [x] 2.4 Tarball contents correct: `npm pack --dry-run` includes payload, excludes `src/`/`test/`/`context/`

#### Manual

- [x] 2.5 Sample `SKILL.md` and `rules/CLAUDE.md` read as sensible starting content
- [x] 2.6 No payload file contains the sentinel marker strings
