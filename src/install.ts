import * as fs from "node:fs";
import * as path from "node:path";

import {
  PACKAGE_NAME,
  PACKAGE_VERSION,
  SENTINEL_BEGIN,
  SENTINEL_END,
  type ToolkitManifest,
} from "./manifest";
import {
  MANIFEST_RELPATH,
  SKILLS_RELDIR,
  locateOrphanMarker,
  removeEmptyDirs,
  resolveTarget,
  stripCr,
  toCrlf,
  toManifestPath,
} from "./consumer";

/** Absolute path to a shipped payload directory (`skills`, `rules`). */
function payloadDir(name: string): string {
  return path.join(__dirname, "..", name);
}

/**
 * Symlink (POSIX) / directory-junction (Windows) each shipped skill directory
 * into `<consumerRoot>/.claude/skills/<name>`. Roaming mode: the link points at
 * the package's copy under `node_modules`, so it follows the dependency on
 * `npm update`.
 *
 * - A link we already own that resolves to the current payload is left as-is.
 * - A link that resolves elsewhere or is broken is removed and recreated.
 * - A real (non-link) entry of the same name is a collision: warn and skip it,
 *   leaving it out of the returned list (full collision policy is S-05).
 *
 * Returns the consumer-root-relative POSIX paths of the links now in place.
 */
function linkSkills(consumerRoot: string): string[] {
  const sourceRoot = payloadDir("skills");
  if (!fs.existsSync(sourceRoot)) return [];

  const linked: string[] = [];
  const targetRoot = path.join(consumerRoot, SKILLS_RELDIR);

  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const name = entry.name;
    const absTarget = path.join(sourceRoot, name);
    const linkPath = path.join(targetRoot, name);
    const relPath = toManifestPath(consumerRoot, linkPath);

    let owned = false;
    try {
      fs.readlinkSync(linkPath);
      owned = true;
    } catch {
      // Any throw (ENOENT, EINVAL, UNKNOWN, EPERM …) means "not a link we can
      // read". Distinguish absent from a real dir/file via existsSync.
      if (fs.existsSync(linkPath)) {
        console.warn(
          `${PACKAGE_NAME}: skipping skill "${name}" — ${relPath} already exists ` +
            `and is not managed by this package.`,
        );
        continue;
      }
    }

    if (owned) {
      let resolvesToTarget = false;
      try {
        resolvesToTarget = fs.realpathSync(linkPath) === fs.realpathSync(absTarget);
      } catch {
        resolvesToTarget = false; // broken link — target missing
      }
      if (resolvesToTarget) {
        linked.push(relPath);
        continue;
      }
      fs.rmSync(linkPath, { recursive: true, force: true });
    }

    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(
      absTarget,
      linkPath,
      process.platform === "win32" ? "junction" : "dir",
    );
    linked.push(relPath);
  }

  return linked;
}

/** `files[]` of the manifest already on disk, or `[]` when absent/unreadable. */
function readPriorManifestFiles(consumerRoot: string): string[] {
  try {
    const previous = JSON.parse(
      fs.readFileSync(path.join(consumerRoot, MANIFEST_RELPATH), "utf8"),
    ) as ToolkitManifest;
    return Array.isArray(previous.files) ? previous.files : [];
  } catch {
    return [];
  }
}

/** Paths of every file under `dir`, relative to `dir` (native separators). */
function listFilesRecursive(dir: string, base: string = dir): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(abs, base));
    else out.push(path.relative(base, abs));
  }
  return out;
}

/**
 * Content-diffing directory sync: make `dstDir` hold exactly the files of
 * `srcDir`. A file is written only when it is missing or its bytes differ, an
 * orphaned destination file (no source counterpart) is removed, and directories
 * emptied by that are pruned. A clean re-run therefore writes nothing.
 *
 * Returns the absolute paths of the files now under `dstDir`.
 */
function syncDir(srcDir: string, dstDir: string): string[] {
  const srcRelPaths = listFilesRecursive(srcDir);
  const srcPosix = new Set(
    srcRelPaths.map((rel) => rel.split(path.sep).join("/")),
  );

  for (const rel of srcRelPaths) {
    const from = path.join(srcDir, rel);
    const to = path.join(dstDir, rel);
    const bytes = fs.readFileSync(from);

    let write = true;
    try {
      write = !fs.readFileSync(to).equals(bytes);
    } catch {
      write = true; // destination missing
    }
    if (write) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, bytes);
    }
  }

  if (fs.existsSync(dstDir)) {
    for (const rel of listFilesRecursive(dstDir)) {
      if (!srcPosix.has(rel.split(path.sep).join("/"))) {
        fs.rmSync(path.join(dstDir, rel), { force: true });
      }
    }
    removeEmptyDirs(dstDir);
  }

  return srcRelPaths.map((rel) => path.join(dstDir, rel));
}

/**
 * Standalone copy mode: copy each shipped skill directory into
 * `<consumerRoot>/.claude/skills/<name>/…` as **real files** — no symlink into
 * `node_modules` (which may not exist, or is an ephemeral `npx` cache). Uses
 * {@link syncDir}, so a re-run with unchanged payload writes nothing.
 *
 * Collision: if `.claude/skills/<name>` exists and the *prior* manifest claims
 * no file beneath it, it is the consumer's own — warn and skip (full collision
 * policy is S-05). Otherwise it is ours (or brand new) and is synced.
 *
 * Returns the consumer-root-relative POSIX paths of every copied file.
 */
function copySkills(consumerRoot: string): string[] {
  const sourceRoot = payloadDir("skills");
  if (!fs.existsSync(sourceRoot)) return [];

  const priorFiles = readPriorManifestFiles(consumerRoot);
  const skillsRelPosix = SKILLS_RELDIR.split(path.sep).join("/");
  const copied: string[] = [];

  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const name = entry.name;
    const srcDir = path.join(sourceRoot, name);
    const dstDir = path.join(consumerRoot, SKILLS_RELDIR, name);
    const relPrefix = `${skillsRelPosix}/${name}/`;

    if (
      fs.existsSync(dstDir) &&
      !priorFiles.some((file) => file.startsWith(relPrefix))
    ) {
      console.warn(
        `${PACKAGE_NAME}: skipping skill "${name}" — ` +
          `${toManifestPath(consumerRoot, dstDir)} already exists and is not ` +
          `managed by this package.`,
      );
      continue;
    }

    for (const abs of syncDir(srcDir, dstDir)) {
      copied.push(toManifestPath(consumerRoot, abs));
    }
  }

  return copied;
}

/**
 * Inject the team rules block into `<consumerRoot>/CLAUDE.md`, fenced by
 * `SENTINEL_BEGIN` / `SENTINEL_END`. Content outside the fences is preserved
 * byte-for-byte.
 *
 * - No file (or empty file) → create it containing only the block.
 * - Well-formed markers present → splice the fresh block between them.
 * - No markers → append the block after the existing content.
 * - Malformed markers (exactly one, or `END` before `BEGIN`) → warn and skip;
 *   the rich abort with a file/line pointer (FR-012) and the sentinel-injection
 *   guard (FR-014) are S-05.
 *
 * A consumer file that uses CRLF endings keeps them: the result is written back
 * with the detected EOL style and is only rewritten when the *content* actually
 * differs, so a no-op re-run in a CRLF repo produces no diff.
 *
 * Returns `["CLAUDE.md"]` when the block is in place, `[]` when it skipped.
 */
function applyRulesBlock(consumerRoot: string): string[] {
  const sourceFile = path.join(payloadDir("rules"), "CLAUDE.md");
  if (!fs.existsSync(sourceFile)) return [];

  const teamRules = fs.readFileSync(sourceFile, "utf8").trim();
  const block = `${SENTINEL_BEGIN}\n${teamRules}\n${SENTINEL_END}`;
  const targetPath = path.join(consumerRoot, "CLAUDE.md");

  const existing = fs.existsSync(targetPath)
    ? fs.readFileSync(targetPath, "utf8")
    : null;

  if (existing === null || existing.trim() === "") {
    fs.writeFileSync(targetPath, block + "\n");
    return ["CLAUDE.md"];
  }

  const begin = existing.indexOf(SENTINEL_BEGIN);
  const end = existing.indexOf(SENTINEL_END);

  if ((begin === -1) !== (end === -1) || (begin !== -1 && end < begin)) {
    const orphan = locateOrphanMarker(existing);
    const where = orphan ? `CLAUDE.md:${orphan.line}` : "CLAUDE.md";
    const which = orphan?.marker ?? (begin === -1 ? "END" : "BEGIN");
    console.warn(
      `${PACKAGE_NAME}: ${where}: team-rules block is corrupted — the ${which} ` +
        `marker has no matching pair; not repairing (MVP). Fix or remove the ` +
        `stray marker, then re-install.`,
    );
    return [];
  }

  const nextLf =
    begin !== -1
      ? existing.slice(0, begin) + block + existing.slice(end + SENTINEL_END.length)
      : stripCr(existing).trimEnd() + "\n\n" + block + "\n";

  const next = /\r\n/.test(existing) ? toCrlf(nextLf) : nextLf;

  if (next !== existing) fs.writeFileSync(targetPath, next);
  return ["CLAUDE.md"];
}

/**
 * Ensure the consumer's project `.npmrc` carries the scope→registry mapping
 * line, and — only when `NODE_AUTH_TOKEN` is set at install time — a credential
 * line that *references* the env var (npm expands it at read time, so no secret
 * is ever written to the file). Existing lines are never parsed or reordered;
 * a line is appended only if no line already equals it (trimmed, CR-insensitive).
 * A CRLF `.npmrc` keeps its endings and is only rewritten when a line is added.
 *
 * Returns `[".npmrc"]` when the file exists or was created, else `[]`.
 */
function ensureNpmrc(consumerRoot: string): string[] {
  const npmrcPath = path.join(consumerRoot, ".npmrc");
  const scope = PACKAGE_NAME.split("/")[0]; // "@10xpackages"
  const registryLine = `${scope}:registry=https://npm.pkg.github.com`;
  // Literal text — `${NODE_AUTH_TOKEN}` is NOT interpolated here (double quotes),
  // it is the reference npm resolves from the environment when it reads .npmrc.
  const authLine = "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}";

  const existedBefore = fs.existsSync(npmrcPath);
  const original = existedBefore ? fs.readFileSync(npmrcPath, "utf8") : "";
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const lines =
    original.trim() === ""
      ? []
      : stripCr(original).replace(/\n+$/, "").split("\n");

  const present = (line: string): boolean =>
    lines.some((existing) => existing.trim() === line);

  const wanted = [registryLine];
  if (process.env.NODE_AUTH_TOKEN) wanted.push(authLine);

  let changed = false;
  for (const line of wanted) {
    if (!present(line)) {
      lines.push(line);
      changed = true;
    }
  }

  if (changed) fs.writeFileSync(npmrcPath, lines.join(eol) + eol);
  return existedBefore || changed ? [".npmrc"] : [];
}

/**
 * Remove artifacts the previous install recorded that this install no longer
 * produces — the withdrawn-artifact reconcile (FR-010). The signal is the set
 * difference `previousManifest.files − currentFiles`.
 *
 * Only skill links this package provably owns are deleted:
 * - `CLAUDE.md` / `.npmrc` are shared content — an update never removes them
 *   (that is uninstall's job, S-03); they are skipped silently.
 * - A stale entry that is still a symlink/junction (even a broken one) is ours
 *   to remove.
 * - A stale entry the consumer has replaced with a real directory/file is left
 *   in place with a warning — same posture as the collision skip in
 *   {@link linkSkills}.
 * - An entry outside `.claude/skills/` is unexpected; warn and leave it.
 *
 * After pruning, an emptied `.claude/skills/` directory is removed so a
 * withdrawn artifact leaves no trace.
 *
 * No previous manifest → nothing to reconcile against (first install). An
 * unreadable manifest → skip the prune with a warning rather than guess what to
 * delete; the forward reconcile and the manifest rewrite still happen.
 */
function pruneWithdrawn(consumerRoot: string, currentFiles: string[]): void {
  const manifestPath = path.join(consumerRoot, MANIFEST_RELPATH);
  if (!fs.existsSync(manifestPath)) return;

  let previousFiles: string[];
  try {
    const previous = JSON.parse(
      fs.readFileSync(manifestPath, "utf8"),
    ) as ToolkitManifest;
    previousFiles = Array.isArray(previous.files) ? previous.files : [];
  } catch {
    console.warn(
      `${PACKAGE_NAME}: previous manifest unreadable — skipping ` +
        `withdrawn-artifact cleanup.`,
    );
    return;
  }

  const current = new Set(currentFiles);
  for (const relPath of previousFiles) {
    if (current.has(relPath)) continue;
    if (relPath === "CLAUDE.md" || relPath === ".npmrc") continue;

    if (!relPath.startsWith(".claude/skills/")) {
      console.warn(
        `${PACKAGE_NAME}: manifest lists a withdrawn entry outside ` +
          `.claude/skills/ (${relPath}) — leaving it in place.`,
      );
      continue;
    }

    const abs = path.join(consumerRoot, ...relPath.split("/"));

    // A path deeper than `.claude/skills/<name>` is a copy-mode file this
    // package wrote — delete it. The bare `.claude/skills/<name>` shape is a
    // roaming-mode link, handled by the ownership probe below.
    if (relPath.split("/").length > 3) {
      if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
      continue;
    }

    let isLink = false;
    try {
      fs.readlinkSync(abs); // succeeds for a symlink/junction, even if broken
      isLink = true;
    } catch {
      isLink = false;
    }

    if (isLink) {
      fs.rmSync(abs, { recursive: true, force: true });
    } else if (fs.existsSync(abs)) {
      console.warn(
        `${PACKAGE_NAME}: withdrawn skill "${relPath}" is now a real ` +
          `directory not managed by this package — leaving it in place.`,
      );
    }
  }

  const skillsDir = path.join(consumerRoot, SKILLS_RELDIR);
  removeEmptyDirs(skillsDir); // prune per-skill dirs emptied by copy-mode removal
  try {
    if (fs.existsSync(skillsDir) && fs.readdirSync(skillsDir).length === 0) {
      fs.rmdirSync(skillsDir);
    }
  } catch {
    // Non-empty or racing with another process — nothing to clean up.
  }
}

/**
 * Write `<consumerRoot>/.claude/.ai-toolkit-manifest.json`, but only when the
 * recomputed manifest differs from any existing one — ignoring `installedAt`.
 * A no-op re-run therefore leaves the file (and its timestamp) byte-identical,
 * which the idempotency NFR requires.
 */
function writeManifest(consumerRoot: string, files: string[]): void {
  const manifestPath = path.join(consumerRoot, MANIFEST_RELPATH);
  const sortedFiles = [...files].sort();

  const candidate: ToolkitManifest = {
    package: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    tool: "claude-code",
    installedAt: new Date().toISOString(),
    files: sortedFiles,
  };

  if (fs.existsSync(manifestPath)) {
    try {
      const existing = JSON.parse(
        fs.readFileSync(manifestPath, "utf8"),
      ) as ToolkitManifest;
      if (
        existing.package === candidate.package &&
        existing.version === candidate.version &&
        existing.tool === candidate.tool &&
        JSON.stringify(existing.files) === JSON.stringify(sortedFiles)
      ) {
        return; // unchanged — preserve installedAt, produce zero diff
      }
    } catch {
      // Corrupt existing manifest — fall through and overwrite it.
    }
  }

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(candidate, null, 2) + "\n");
}

/**
 * Installer entrypoint. Reconciles the consumer's AI-tool artifacts with this
 * package version: lay out skills (symlink/junction in roaming mode, real copies
 * in standalone `--copy` mode), inject the sentinel-fenced rules block, ensure
 * the registry-mapping line (roaming mode, or copy mode when a `package.json` is
 * present), remove artifacts withdrawn since the last install (manifest diff),
 * then write the manifest. `options.copy` forces copy mode; otherwise
 * {@link resolveTarget} picks the mode. Never throws — an exception here must
 * not fail a consumer's `npm install`; failures downgrade to `console.warn`.
 */
export async function runInstall(
  options: { copy?: boolean } = {},
): Promise<void> {
  try {
    const target = resolveTarget(options);
    if (target === null) {
      console.log(
        `${PACKAGE_NAME}: running from a toolkit checkout, nothing to install.`,
      );
      return;
    }
    const { root, mode } = target;

    const files: string[] = [];
    files.push(...(mode === "copy" ? copySkills(root) : linkSkills(root)));
    files.push(...applyRulesBlock(root));
    if (mode === "link" || fs.existsSync(path.join(root, "package.json"))) {
      files.push(...ensureNpmrc(root));
    }
    pruneWithdrawn(root, files);
    writeManifest(root, files);

    console.log(
      `${PACKAGE_NAME}: ${mode === "copy" ? "copied" : "installed"} ` +
        `${files.length} file(s) into ${root}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`${PACKAGE_NAME}: install warning: ${message}`);
  }
}
