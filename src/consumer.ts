import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Consumer-side path discovery and line-ending helpers shared by the installer
 * ({@link file://./install.ts}) and the uninstaller ({@link file://./uninstall.ts}).
 *
 * Kept in one module so the `node_modules` walk and the CRLF logic have a single
 * definition — drift between the two entrypoints would break one of them
 * silently. Contains no package-specific behaviour, only these primitives.
 */

/** Consumer-root-relative location of the install manifest. */
export const MANIFEST_RELPATH = path.join(".claude", ".ai-toolkit-manifest.json");

/** Consumer-root-relative directory Claude Code reads skills from. */
export const SKILLS_RELDIR = path.join(".claude", "skills");

/**
 * Walk up from this module's directory looking for an enclosing `node_modules/`.
 * When found, the parent of `node_modules/` is the consumer project root and the
 * package is running as an installed dependency. When not found, we are running
 * from a checkout of the toolkit repo itself (local dev, CI) and there is
 * nothing to install or uninstall. `PROJECT_ROOT` overrides both (used by the
 * test suite).
 */
export function findConsumerRoot(): string | null {
  if (process.env.PROJECT_ROOT) return process.env.PROJECT_ROOT;

  let dir = __dirname;
  while (dir !== path.dirname(dir)) {
    if (path.basename(dir) === "node_modules") return path.dirname(dir);
    dir = path.dirname(dir);
  }
  return null;
}

/** Consumer-root-relative path with forward slashes, for the manifest. */
export function toManifestPath(consumerRoot: string, absPath: string): string {
  return path.relative(consumerRoot, absPath).split(path.sep).join("/");
}

/** Drop CR so line-ending style alone doesn't register as a content change. */
export function stripCr(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/** Re-apply CRLF endings to text assembled with LF. */
export function toCrlf(text: string): string {
  return stripCr(text).replace(/\n/g, "\r\n");
}
