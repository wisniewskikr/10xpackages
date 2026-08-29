import * as fs from "node:fs";
import * as path from "node:path";

import { PACKAGE_NAME } from "./manifest";

/**
 * Consumer-side path discovery and line-ending helpers shared by the installer
 * ({@link file://./install.ts}) and the uninstaller ({@link file://./uninstall.ts}).
 *
 * Kept in one module so the `node_modules` walk, the copy-vs-link decision, and
 * the CRLF logic have a single definition — drift between the two entrypoints
 * would break one of them silently. Contains no package-specific behaviour
 * beyond the package name used to recognise a checkout of the toolkit itself.
 */

/** Consumer-root-relative location of the install manifest. */
export const MANIFEST_RELPATH = path.join(".claude", ".ai-toolkit-manifest.json");

/** Consumer-root-relative directory Claude Code reads skills from. */
export const SKILLS_RELDIR = path.join(".claude", "skills");

/** How skills are materialised into the consumer project. */
export type InstallMode = "link" | "copy";

/** A resolved install target: where artifacts go, and how skills are laid down. */
export interface ResolvedTarget {
  /** Absolute consumer project root. */
  root: string;
  /**
   * `"link"` — symlink/junction each skill into `node_modules` (roaming mode);
   * `"copy"` — copy each skill in as real files (standalone mode, for a repo
   * with no package manager or an ephemeral `npx` cache).
   */
  mode: InstallMode;
}

/**
 * Walk up from `start` looking for an enclosing `node_modules/`. Returns the
 * parent of the nearest ancestor `node_modules/`, or `null` when there is none.
 */
function nodeModulesParent(start: string): string | null {
  let dir = start;
  while (dir !== path.dirname(dir)) {
    if (path.basename(dir) === "node_modules") return path.dirname(dir);
    dir = path.dirname(dir);
  }
  return null;
}

/** `true` when `child` is `parent` itself or nested anywhere beneath it. */
function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + path.sep);
}

/** `name` field of `<dir>/package.json`, or `null` if it can't be read/parsed. */
function readPackageName(dir: string): string | null {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(dir, "package.json"), "utf8"),
    ) as { name?: string };
    return typeof pkg.name === "string" ? pkg.name : null;
  } catch {
    return null;
  }
}

/**
 * Resolve where this run should install and how skills should be materialised.
 *
 * - `opts.copy` forces copy mode into `PROJECT_ROOT` (tests) or `process.cwd()`.
 * - `PROJECT_ROOT` (test override) → that dir, link mode.
 * - Running as a real dependency — an ancestor `node_modules/` whose parent
 *   contains `process.cwd()` — → that parent, link (roaming) mode. This covers
 *   the `postinstall` hook, whose cwd is `<root>/node_modules/<pkg>`.
 * - Otherwise (invoked via `npx` from a project whose `node_modules` cache is
 *   not an ancestor of cwd, or a repo with no `node_modules` at all) →
 *   `process.cwd()`, copy mode — unless cwd is a checkout of this toolkit repo
 *   itself (`package.json#name === PACKAGE_NAME`), which is a no-op (`null`).
 */
export function resolveTarget(opts: { copy?: boolean } = {}): ResolvedTarget | null {
  if (opts.copy) {
    return { root: process.env.PROJECT_ROOT ?? process.cwd(), mode: "copy" };
  }
  if (process.env.PROJECT_ROOT) {
    return { root: process.env.PROJECT_ROOT, mode: "link" };
  }

  const walkRoot = nodeModulesParent(__dirname);
  const cwd = process.cwd();
  if (walkRoot !== null && isInside(cwd, walkRoot)) {
    return { root: walkRoot, mode: "link" };
  }

  if (readPackageName(cwd) === PACKAGE_NAME) return null;
  return { root: cwd, mode: "copy" };
}

/**
 * Consumer project root, or `null` when running from a checkout of the toolkit
 * itself. Thin wrapper over {@link resolveTarget} so the installer and the
 * uninstaller share one resolution rule (including the `npx`/cwd fallback).
 */
export function findConsumerRoot(): string | null {
  return resolveTarget()?.root ?? null;
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

/**
 * Recursively remove empty directories *under* `dir` (post-order). `dir` itself
 * is left in place even when it ends up empty — callers decide whether to prune
 * it. Any unreadable/racing directory is silently skipped.
 */
export function removeEmptyDirs(dir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sub = path.join(dir, entry.name);
    removeEmptyDirs(sub);
    try {
      if (fs.readdirSync(sub).length === 0) fs.rmdirSync(sub);
    } catch {
      // non-empty or already gone
    }
  }
}
