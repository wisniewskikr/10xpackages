# @10xpackages/ai-toolkit

## Description

Team AI artifacts — **skills** and **rules** — shipped as one **private npm
package** through GitHub Packages. Think of it as a shared toolbox: the team
fills it once, every project borrows from it with one command, and CI publishes a
new version whenever `main` changes.

## Project structure

| Path | What it holds |
| --- | --- |
| `src/manifest.ts` | Sentinel markers + install-manifest contract |
| `src/consumer.ts` | Consumer-root discovery, line-ending helpers |
| `src/install.ts` | Installer — skill links or file copies, rules block, `.npmrc` line, manifest, prune of withdrawn skills |
| `src/uninstall.ts` | Uninstaller — removes exactly what the manifest recorded |
| `src/cli.ts` | `ai-toolkit` command dispatch |
| `bin/ai-toolkit.js` | Thin launcher → `dist/cli.js` |
| `skills/<name>/` | Shipped skills, one folder each |
| `rules/CLAUDE.md` | Shipped team rules block |
| `dist/` | Build output (git-ignored, published) |
| `test/` | Vitest suite |
| `examples/consumer-ci.yml` | Sample workflow a consumer repo copies in |
| `.github/workflows/publish-ai-toolkit.yml` | Publish-on-merge pipeline |
| `context/` | Product docs (`foundation/`) and per-change plans (`changes/`) |

## Developer usage

### Scripts

| Command | What it does |
| --- | --- |
| `npm run build` | tsup → `dist/` (CJS, Node 20) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Build, then run Vitest |

### Change the toolkit

| Goal | Steps |
| --- | --- |
| **Add a skill** | Create `skills/<name>/SKILL.md` (+ any support files) → `npm test` → bump `version` in `package.json` → merge to `main` |
| **Update a skill** | Edit files under `skills/<name>/` → bump `version` → merge |
| **Remove a skill** | Delete `skills/<name>/` → bump `version` → merge (consumers prune it on their next install) |
| **Change rules** | Edit `rules/CLAUDE.md` → bump `version` → merge |

**One rule to remember:** every change to a packaged file needs a manual
`version` bump in `package.json` before merge, or the CI publish job fails red.

## User usage

### Node repo

1. Add one line to the project `.npmrc`:
   ```
   @10xpackages:registry=https://npm.pkg.github.com
   ```
2. Add `@10xpackages/ai-toolkit` to `devDependencies`.
3. `npm install`. The `postinstall` hook runs `ai-toolkit install`, which lays down:

| What | Where |
| --- | --- |
| Each skill | `.claude/skills/<name>` — symlink / junction into `node_modules` (roams on update) |
| Rules block | `CLAUDE.md`, between `<!-- BEGIN/END @10xpackages/ai-toolkit -->` markers |
| Registry line | `.npmrc` (appended if missing) |
| Manifest | `.claude/.ai-toolkit-manifest.json` |

### Everyday actions

| Action | How |
| --- | --- |
| **Update** | Bump the dependency version → re-install. New skills roam in, withdrawn ones are pruned, re-runs are diff-free |
| **Uninstall** | Run `ai-toolkit uninstall` **before** dropping the dependency (npm has no uninstall hook). Removes only what it installed |
| **Non-Node repo** (Python/Go/Rust) | Run `npx @10xpackages/ai-toolkit install` from the project root — skills are copied as real files. Re-run to refresh; `npx @10xpackages/ai-toolkit uninstall` to reverse |

### Commit vs ignore

- **Commit:** `.claude/.ai-toolkit-manifest.json`, the `CLAUDE.md` rules block, the `.npmrc` line.
- **Gitignore:** `/.claude/skills/` — regenerated on every install.
- **Auth:** `npm login` against `npm.pkg.github.com` once locally; in CI use `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. Never commit a token.
