# @10xpackages/ai-toolkit

Team AI artifacts — skills and rules — distributed as a **private npm package**
through GitHub Packages. One source of truth, manual versioning, CI publish on
merge, and one-command install in any consumer repo.

## Status

**Consumer install — symlink mode (S-01).** `install` now performs a real
reconcile against the consumer project. `uninstall` is still a stub (S-03).

Not yet implemented: update / withdrawn-artifact reconcile (S-02), uninstall
(S-03), copy-mode `npx` install for repos without a project manifest (S-04), and
the rich unsafe-state refusals — corrupted-block abort with a file/line pointer,
sentinel-injection guard, full skill-name-collision policy (S-05).

## Layout

```
src/            TypeScript sources (build input)
  manifest.ts   sentinel markers + ToolkitManifest contract
  install.ts    installer — skill links, rules block, .npmrc line, manifest
  uninstall.ts  uninstaller entrypoint (stub — S-03)
  cli.ts        `ai-toolkit` command dispatch
bin/ai-toolkit.js   thin launcher -> dist/cli.js
skills/         shipped skills, one dir per skill
rules/          shipped team rules block
dist/           build output (git-ignored, published)
test/           Vitest suite
```

## Scripts

| Command             | What it does                              |
| ------------------- | ----------------------------------------- |
| `npm run build`     | tsup -> `dist/` (CJS, Node 20 target)     |
| `npm run typecheck` | `tsc --noEmit`                            |
| `npm test`          | build, then run the Vitest suite          |

## Consumer setup

A consumer repo opts in by committing one line to its project `.npmrc`:

```
@10xpackages:registry=https://npm.pkg.github.com
```

then adds `@10xpackages/ai-toolkit` as a dependency and runs a normal install.
The `postinstall` hook runs `ai-toolkit install`, which reconciles the project:

| What | Where | Notes |
| --- | --- | --- |
| Each shipped skill | `.claude/skills/<name>` | symlink (POSIX) / directory junction (Windows) into `node_modules` — roams with the dependency on update |
| Team rules block | `CLAUDE.md` (project root) | inserted/replaced between `<!-- BEGIN @10xpackages/ai-toolkit -->` and `<!-- END … -->`; anything outside the markers is left untouched |
| Registry mapping | `.npmrc` | the scope→registry line above is appended if missing; existing entries are never modified |
| Credential line | `.npmrc` | `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` — added **only** when `NODE_AUTH_TOKEN` is set at install time, and it is the literal env-var reference (npm expands it at read time), never the token value. A missing env var does not block the install. |
| Install manifest | `.claude/.ai-toolkit-manifest.json` | `{ package, version, tool, installedAt, files[] }` — the exact list update/uninstall act on |

Running the install twice produces no diff (idempotent).

### What to commit

- **Commit** `.claude/.ai-toolkit-manifest.json` — update and uninstall read it,
  so keeping it in version control makes those operations reproducible for the
  whole team.
- **Gitignore the managed skill entries** under `.claude/skills/` — in symlink
  mode they are regenerated from `node_modules` on every install, and a
  committed symlink is fragile across platforms (a Windows checkout without
  `core.symlinks` stores it as a text file holding the target path). Add e.g.
  `/.claude/skills/` to `.gitignore`.
- The `CLAUDE.md` rules block and the `.npmrc` line are real content — commit
  them normally.

Auth is a short-lived credential in CI (`GITHUB_TOKEN` → `NODE_AUTH_TOKEN`) or a
local `npm login` — never a committed token.

## Context

Product docs live in [`context/foundation/`](context/foundation/): `prd.md`,
`roadmap.md`, `tech-stack.md`. This change's plan is in
`context/changes/consumer-install-symlink/`.
