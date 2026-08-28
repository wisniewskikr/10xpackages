# @10xpackages/ai-toolkit

Team AI artifacts — skills and rules — distributed as a **private npm package**
through GitHub Packages. One source of truth, manual versioning, CI publish on
merge, and one-command install in any consumer repo.

## Status

**Skeleton (F-01).** This package currently ships:

- the npm manifest, TypeScript + [tsup](https://tsup.egoist.dev/) build, and
  [Vitest](https://vitest.dev/) harness;
- the payload layout — `skills/` and `rules/`;
- **stub** entrypoints: `install` / `uninstall` compile and run but do not yet
  reconcile anything.

The real consumer-side reconcile logic (lay out skills, inject the
sentinel-fenced team rules block, ensure the registry-mapping line, write and
read the install manifest) lands in the `consumer-install-symlink` change (S-01).

## Layout

```
src/            TypeScript sources (build input)
  manifest.ts   sentinel markers + ToolkitManifest contract
  install.ts    installer entrypoint (stub)
  uninstall.ts  uninstaller entrypoint (stub)
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

## Consumer setup (preview)

A consumer repo opts in by committing one line to its `.npmrc`:

```
@10xpackages:registry=https://npm.pkg.github.com
```

then installs the package like any other dependency. Auth is a short-lived
credential in CI (`GITHUB_TOKEN`) or a local `npm login` — never a committed
token.

## Context

Product docs live in [`context/foundation/`](context/foundation/): `prd.md`,
`roadmap.md`, `tech-stack.md`. This change's plan is in
`context/changes/package-skeleton/`.
