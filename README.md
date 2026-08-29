# @10xpackages/ai-toolkit

Team AI artifacts — skills and rules — distributed as a **private npm package**
through GitHub Packages. One source of truth, manual versioning, CI publish on
merge, and one-command install in any consumer repo.

## Status

**Consumer install + update + uninstall (S-01, S-02, S-03).** `install` performs
a real reconcile against the consumer project, including removing artifacts
withdrawn since the last version and staying diff-free on CRLF repos.
`uninstall` reads the install manifest and removes exactly what it recorded —
skill links, the `CLAUDE.md` rules block, the `.npmrc` lines — leaving the
consumer's own content untouched and the repo free of package traces.

Not yet implemented: copy-mode `npx` install for repos without a project
manifest (S-04), and the rich unsafe-state refusals — corrupted-block abort with
a file/line pointer, sentinel-injection guard, full skill-name-collision policy,
corrupted-manifest candidate listing (S-05).

## Layout

```
src/            TypeScript sources (build input)
  manifest.ts   sentinel markers + ToolkitManifest contract
  consumer.ts   shared consumer-root discovery + line-ending helpers
  install.ts    installer — skill links, rules block, .npmrc line, manifest, withdrawn-artifact prune
  uninstall.ts  uninstaller — manifest-driven removal of every file install wrote
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

### Consumer update

Bumping `@10xpackages/ai-toolkit` in the consumer's manifest and running a normal
install (`npm update`, or a plain re-install) re-runs the same reconcile:

- **New content roams automatically.** Skill entries are symlinks/junctions into
  `node_modules`, so a new package version's skills are picked up with no
  installer action. The `CLAUDE.md` rules block is re-derived from the payload on
  every run, so it always reflects the installed version.
- **Withdrawn artifacts are removed.** The installer diffs the previous
  `.claude/.ai-toolkit-manifest.json` against the files the new version
  produces; a skill dropped from the new version has its
  `.claude/skills/<name>` link deleted, and an emptied `.claude/skills/` is
  removed. A stale entry the consumer has replaced with a real directory is left
  in place with a warning; a missing or unreadable prior manifest skips the
  cleanup (with a warning) rather than guessing what to delete.
- **Still diff-free.** A re-run on a clean tree produces no diff, including in a
  repo whose `CLAUDE.md` / `.npmrc` use CRLF endings — the installer compares
  content ignoring line-ending style and writes back with the file's own EOL.

What an update does **not** touch: content outside the rules-block markers,
unrelated `.npmrc` entries, and — on a downgrade or removal — the rules block and
the `.npmrc` line themselves (removing those is `uninstall`'s job).

### Consumer uninstall

Running `ai-toolkit uninstall` (or `npx @10xpackages/ai-toolkit uninstall`)
reverses the install, using the committed manifest as the source of truth:

- **Skill links** listed in the manifest are removed; a `.claude/skills/` left
  empty is deleted, and so is `.claude/` if nothing else lives there.
- **The `CLAUDE.md` rules block** between the sentinel markers is stripped;
  text outside the markers is kept byte-for-byte. If the block was the only
  content, the file is removed.
- **The `.npmrc` lines the installer added** — the scope→registry mapping and,
  when present, the `${NODE_AUTH_TOKEN}` credential reference — are removed;
  unrelated entries stay. An emptied `.npmrc` is deleted.
- **The manifest** (`.claude/.ai-toolkit-manifest.json`) is deleted last.

Afterwards version control shows no package artifact. Uninstall is **idempotent**
(a second run finds no manifest and does nothing) and **CRLF-safe** (it touches
only the lines it owns).

It is a deliberate command, **not** an npm lifecycle hook — npm does not run a
dependency's scripts when the dependency is removed, so run `ai-toolkit
uninstall` yourself before dropping `@10xpackages/ai-toolkit` from your manifest.
It does not touch `package.json` or the lockfile.

If the manifest is missing or unparseable, uninstall makes **no changes** and
warns rather than guessing what to delete. (Listing candidate files for manual
removal in that case is planned for S-05.)

### What to commit

- **Commit** `.claude/.ai-toolkit-manifest.json` — the update reconcile diffs the
  committed manifest against the new version to decide what to remove, and
  uninstall reads it too, so keeping it in version control makes both operations
  reproducible for the whole team.
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
`roadmap.md`, `tech-stack.md`. Per-change plans are in `context/changes/` —
`consumer-install-symlink/` (S-01), `consumer-update-and-reconcile/` (S-02), and
`consumer-uninstall-clean/` (S-03).
