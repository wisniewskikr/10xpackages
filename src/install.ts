import * as fs from "node:fs";
import * as path from "node:path";

import { PACKAGE_NAME, PACKAGE_VERSION, type ToolkitManifest } from "./manifest";

/** Consumer-root-relative location of the install manifest. */
const MANIFEST_RELPATH = path.join(".claude", ".ai-toolkit-manifest.json");
/** Consumer-root-relative directory Claude Code reads skills from. */
const SKILLS_RELDIR = path.join(".claude", "skills");

/**
 * Walk up from this module's directory looking for an enclosing `node_modules/`.
 * When found, the parent of `node_modules/` is the consumer project root and the
 * package is running as an installed dependency. When not found, we are running
 * from a checkout of the toolkit repo itself (local dev, CI) and install is a
 * no-op. `PROJECT_ROOT` overrides both (used by the test suite).
 */
function findConsumerRoot(): string | null {
  if (process.env.PROJECT_ROOT) return process.env.PROJECT_ROOT;

  let dir = __dirname;
  while (dir !== path.dirname(dir)) {
    if (path.basename(dir) === "node_modules") return path.dirname(dir);
    dir = path.dirname(dir);
  }
  return null;
}

/** Absolute path to a shipped payload directory (`skills`, `rules`). */
function payloadDir(name: string): string {
  return path.join(__dirname, "..", name);
}

/** Consumer-root-relative path with forward slashes, for the manifest. */
function toManifestPath(consumerRoot: string, absPath: string): string {
  return path.relative(consumerRoot, absPath).split(path.sep).join("/");
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
 * package version: lay out skill links, (Phase 2) inject the sentinel-fenced
 * rules block, (Phase 3) ensure the registry-mapping line, then write the
 * manifest. Never throws — an exception here must not fail a consumer's
 * `npm install`; failures downgrade to `console.warn`.
 */
export async function runInstall(): Promise<void> {
  try {
    const consumerRoot = findConsumerRoot();
    if (consumerRoot === null) {
      console.log(
        `${PACKAGE_NAME}: running from a toolkit checkout, nothing to install.`,
      );
      return;
    }

    const files: string[] = [];
    files.push(...linkSkills(consumerRoot));
    writeManifest(consumerRoot, files);

    console.log(
      `${PACKAGE_NAME}: installed ${files.length} file(s) into ${consumerRoot}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`${PACKAGE_NAME}: install warning: ${message}`);
  }
}
