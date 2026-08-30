/**
 * Boundary contracts for the @wisniewskikr/ai-toolkit installer.
 *
 * This module is the single source of truth for the two interfaces that the
 * consumer-side reconcile logic (change: consumer-install-symlink / S-01 and
 * installer-safe-refusals / S-05) will build on:
 *
 *   1. the sentinel markers that fence the team rules block inside the
 *      consumer's AI-tool rules file, and
 *   2. the shape of the install manifest that update / uninstall read back.
 *
 * It contains no behaviour — only constants and types.
 */

/** Published package name. Must match `package.json#name`. */
export const PACKAGE_NAME = "@wisniewskikr/ai-toolkit";

/**
 * Package version, hand-synced with `package.json#version` for the MVP.
 * `test/manifest.test.ts` asserts the two stay equal; OQ-1 tracks automating this.
 */
export const PACKAGE_VERSION = "0.1.0";

/** Opening fence for the managed team-rules block in the consumer rules file. */
export const SENTINEL_BEGIN = `<!-- BEGIN ${PACKAGE_NAME} -->`;

/** Closing fence for the managed team-rules block in the consumer rules file. */
export const SENTINEL_END = `<!-- END ${PACKAGE_NAME} -->`;

/** AI tool this package targets. MVP is Claude Code only (PRD Non-Goals; OQ-2). */
export type TargetTool = "claude-code";

/**
 * The install manifest written under the consumer's `.claude/` directory.
 * `files` is the exact list the uninstaller removes — no directory-walk guessing.
 */
export interface ToolkitManifest {
  /** Package name, e.g. "@wisniewskikr/ai-toolkit". */
  package: string;
  /** Installed package version. */
  version: string;
  /** AI tool the artifacts were laid out for. */
  tool: TargetTool;
  /** ISO-8601 timestamp of the install/update that wrote this manifest. */
  installedAt: string;
  /** Repo-relative paths of every file the installer created. */
  files: string[];
}
