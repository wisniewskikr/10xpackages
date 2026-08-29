# @10xpackages/ai-toolkit

Team AI artifacts — skills and rules — distributed as a **private npm package**
through GitHub Packages. One source of truth, manual versioning, CI publish on
merge, and one-command install in any consumer repo.

## Status

**Consumer install + update + uninstall + standalone copy + safe refusals
(S-01, S-02, S-03, S-04, S-05).** `install` performs a real reconcile against the
consumer project, including removing artifacts withdrawn since the last version
and staying diff-free on CRLF repos. In a project with no `package.json` (or with
`--copy`), it lays skills down as real file copies instead of symlinks.
`uninstall` reads the install manifest and removes exactly what it recorded —
skill links or copied files, the `CLAUDE.md` rules block, the `.npmrc` lines —
leaving the consumer's own content untouched and the repo free of package
traces. Unsafe states get a loud, actionable refusal rather than silent damage
(see **Safe refusals** below).

## Layout

```
src/            TypeScript sources (build input)
  manifest.ts   sentinel markers + ToolkitManifest contract
  consumer.ts   shared consumer-root discovery, line-ending + orphan-marker helpers
  install.ts    installer — skill links (roaming) or file copies (standalone), rules block, .npmrc line, manifest, withdrawn-artifact prune, sentinel-injection guard
  uninstall.ts  uninstaller — manifest-driven removal of every file install wrote; candidate listing on a corrupt manifest
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
warns rather than guessing what to delete. When the manifest is *unparseable* it
also prints a best-effort list of paths this package plausibly installed — skill
entries under `.claude/skills/`, `CLAUDE.md` if it still carries the rules block,
`.npmrc` if it still carries the installer's lines, and the manifest itself — so
you have a manual cleanup path. Nothing is deleted, and there is no `--force`.

### Safe refusals

The installer refuses, loudly, in three states where blindly proceeding would
damage the consumer's files (PRD FR-012 / FR-014 / FR-013):

- **Corrupted rules block.** If `CLAUDE.md` has one sentinel marker without its
  pair (or `END` before `BEGIN`), `install` and `uninstall` both warn with a
  `CLAUDE.md:<line>` pointer at the orphaned marker and leave the file untouched.
  No automatic repair is attempted in the MVP — fix or remove the stray marker,
  then re-run.
- **Sentinel-injection guard.** If the team-rules payload body itself contains
  either boundary marker, `install` refuses to write the block (a later install
  could otherwise mistake the planted marker for a real fence and splice away
  surrounding content) and leaves `CLAUDE.md` untouched.
- **Corrupted manifest on uninstall.** Covered just above — candidate list, no
  deletion.

**Skill-name collisions (OQ-5, resolved).** If a shipped skill has the same name
as a directory the consumer already has under `.claude/skills/`, the installer
**warns and skips** that skill, leaving the consumer's directory untouched and
out of the manifest. That is the final MVP policy — no scope-prefixing, no hard
abort.

### Standalone copy install

For a repo that has **no `package.json`** — a Python, Go, or Rust project — run
the installer directly:

```
npx @10xpackages/ai-toolkit install
```

from the project root. With no package manager to hook into, it switches to
**copy mode**:

- Each shipped skill is **copied** into `.claude/skills/<name>/…` as real
  files, not symlinked into `node_modules` (there is none, and the `npx` cache
  is transient). The manifest lists every copied file rather than the skill
  directory.
- The `CLAUDE.md` rules block is injected exactly as in roaming mode.
- **No `.npmrc` line is written** — it is only meaningful with a package
  manager. If a `package.json` *is* present (a Node repo where you passed
  `--copy` deliberately), the registry line is still added.

The target is the **current working directory**, so run the command from the
project root. Re-running is diff-free (files are compared byte-for-byte and
rewritten only on change). Because the copies do not follow `npm update`,
refresh them by re-running `install`; withdrawn skills are pruned on that
re-run via the same manifest diff as roaming mode.

`npx @10xpackages/ai-toolkit uninstall` reverses a copy install from the
manifest — removing the copied files, the `CLAUDE.md` block, the emptied
`.claude/` directories, and the manifest — same as for a roaming install.

Pass `--copy` to force copy mode in a repo that *does* have a `package.json`.

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

## CI publish on merge (S-06)

`.github/workflows/publish-ai-toolkit.yml` turns "merge to `main`" into "a new
version in the org's private GitHub Packages registry", in one run, with no
stored secret.

| Event | What runs |
| --- | --- |
| `pull_request` → `main` | `validate` only — `npm ci`, `typecheck`, `build`, `test`, `npm pack --dry-run`. Never publishes. |
| `push` → `main` | `validate`, then `publish` (gated — see below). |

**The publish gate.** The `publish` job checks out full history + tags and
decides:

| Last `vX.Y.Z` tag | Packaged files changed since it? | `package.json#version` already in the registry? | Outcome |
| --- | --- | --- | --- |
| none (first release) | — | — | publish, then tag `v0.1.0` |
| present | no | — | **green no-op** — "nothing to publish" |
| present | yes | no | publish the bumped version, then tag it |
| present | yes | yes | **red build** — "bump \"version\" in package.json" (FR-004) |

"Packaged files" = `src bin skills rules README.md package.json tsconfig.json
tsup.config.ts .github/workflows` diffed across `<last tag>..HEAD` (FR-003 diff
gate). A merge that touches only `context/`, docs, or unrelated config produces
no release.

**Auth.** `permissions: contents: write` (to push the release tag) +
`packages: write`; the publish and tag-probe steps set `NODE_AUTH_TOKEN: ${{
secrets.GITHUB_TOKEN }}` — the token GitHub Actions injects for the run. No PAT,
no repo secret. A `concurrency` group per ref serializes rapid merges.

**The only manual step is the version bump** in `package.json` before merging —
automated semantic versioning is deferred (OQ-1). Forget to bump after changing a
packaged file and the run fails red rather than silently skipping.

**One-time setup.** The `@10xpackages/ai-toolkit` package must be linked to this
repository in GitHub Packages so the run's `GITHUB_TOKEN` can write to it. The
published tarball itself contains `.github/workflows/publish-ai-toolkit.yml` (the
pipeline definition ships with the package — US-01 AC).

## Consumer CI — registry round trip (S-07)

The publish half (S-06) and the install half (S-01) meet on a real published
version in a **consumer repo's own CI**. `test/round-trip.test.ts` proves the
contract against the packed artifact; this section is the deployment recipe for a
sibling repo.

**The opt-in is one committed line.** A consumer repo becomes a consumer by
committing a project `.npmrc` with exactly the scope→registry mapping — the same
line the installer would append, and nothing else:

```
@10xpackages:registry=https://npm.pkg.github.com
```

No token is ever committed. That line plus `@10xpackages/ai-toolkit` in
`package.json` dependencies is the whole opt-in.

**CI pulls it with an ephemeral credential.** Copy
[`examples/consumer-ci.yml`](examples/consumer-ci.yml) into the consumer repo as
a workflow. It uses `actions/setup-node` with `registry-url` + `scope` and runs
`npm ci` with `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` under
`permissions: packages: read`. No PAT, no stored secret.

| Step | Who provides auth |
| --- | --- |
| **Fetch** the private package (`npm ci` resolving the dependency) | `actions/setup-node`'s job-scoped `.npmrc` + `NODE_AUTH_TOKEN` |
| **Reconcile** (`postinstall` → `ai-toolkit install`) | runs *after* the fetch; writes its own conditional `${NODE_AUTH_TOKEN}` line only as a convenience for later installer re-runs — it does **not** bootstrap the fetch above |

**One-time GitHub setting.** A private package is not readable by another repo's
`GITHUB_TOKEN` by default. In the package's **Settings → Manage Actions access**,
add the consumer repo with `Read`. Without it the run fails at `npm ci` with a
403/404 on the package.

**Local developers** skip all of this — `npm login` against
`npm.pkg.github.com` once, and a missing `NODE_AUTH_TOKEN` never blocks an
install. Registry mapping + auth on a clean Windows shell is still open (OQ-4).

## Context

Product docs live in [`context/foundation/`](context/foundation/): `prd.md`,
`roadmap.md`, `tech-stack.md`. Per-change plans are in `context/changes/` —
`consumer-install-symlink/` (S-01), `consumer-update-and-reconcile/` (S-02),
`consumer-uninstall-clean/` (S-03), `standalone-copy-install/` (S-04),
`installer-safe-refusals/` (S-05), `ci-publish-on-merge/` (S-06), and
`registry-round-trip/` (S-07).
