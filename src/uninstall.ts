import * as fs from "node:fs";
import * as path from "node:path";

import {
  PACKAGE_NAME,
  SENTINEL_BEGIN,
  SENTINEL_END,
  type ToolkitManifest,
} from "./manifest";
import {
  MANIFEST_RELPATH,
  SKILLS_RELDIR,
  findConsumerRoot,
  stripCr,
  toCrlf,
} from "./consumer";

/** Manifest paths under this prefix are skill links laid out by {@link linkSkills}. */
const SKILLS_POSIX_PREFIX = ".claude/skills/";

/**
 * The exact `.npmrc` lines the installer appends (see `ensureNpmrc` in
 * `install.ts`). Uninstall removes lines equal to these — trimmed,
 * CR-insensitive — and leaves every other line untouched.
 */
const REGISTRY_LINE = `${PACKAGE_NAME.split("/")[0]}:registry=https://npm.pkg.github.com`;
// Literal reference — `${NODE_AUTH_TOKEN}` is not interpolated (single-quoted
// context via template with no expansion); it is the text npm resolves at read
// time, present whether or not the env var is set now.
const AUTH_LINE = "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}";

/**
 * Strip the sentinel-fenced team-rules block from `raw` — the inverse of
 * `applyRulesBlock` in `install.ts`, and CRLF-agnostic.
 *
 * - Both markers present and well-formed → cut `[BEGIN … END]`, tidy the seam
 *   (`trimEnd` the head, drop leading whitespace on the tail, single blank line
 *   between surviving halves), restore `\r\n` if the original used it.
 * - Exactly one marker, or END before BEGIN → return `null`; the caller warns
 *   and leaves the file untouched (mirrors the installer's malformed posture).
 * - Neither marker → return `raw` unchanged (nothing to do).
 */
function removeRulesBlock(raw: string): string | null {
  const lf = stripCr(raw);
  const begin = lf.indexOf(SENTINEL_BEGIN);
  const end = lf.indexOf(SENTINEL_END);

  if ((begin === -1) !== (end === -1) || (begin !== -1 && end < begin)) {
    return null;
  }
  if (begin === -1) return raw;

  const head = lf.slice(0, begin).replace(/\s+$/, "");
  const tail = lf.slice(end + SENTINEL_END.length).replace(/^\s+/, "");

  let next: string;
  if (head === "" && tail === "") {
    next = "";
  } else if (head === "") {
    next = tail.endsWith("\n") ? tail : tail + "\n";
  } else if (tail === "") {
    next = head + "\n";
  } else {
    next = head + "\n\n" + (tail.endsWith("\n") ? tail : tail + "\n");
  }

  return /\r\n/.test(raw) ? toCrlf(next) : next;
}

/**
 * Drop the installer's registry-mapping line and its `${NODE_AUTH_TOKEN}`
 * credential line from `.npmrc` contents. Every other line — and the file's own
 * EOL style — passes through untouched. Returns `""` when nothing meaningful is
 * left (the caller then deletes the file).
 */
function removeNpmrcLines(raw: string): string {
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const hadTrailingEol = /\r?\n$/.test(raw);

  const kept = stripCr(raw)
    .replace(/\n+$/, "")
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return t !== REGISTRY_LINE && t !== AUTH_LINE;
    });

  if (kept.every((line) => line.trim() === "")) return "";
  return kept.join(eol) + (hadTrailingEol ? eol : "");
}

/**
 * Uninstaller entrypoint. Reads the install manifest and reverses exactly what
 * it recorded: removes owned skill links, strips the sentinel-fenced rules
 * block from `CLAUDE.md`, removes the two known `.npmrc` lines, deletes any file
 * left empty by that, cleans up emptied `.claude/skills/` and `.claude/`, then
 * deletes the manifest. Shared files keep every line the consumer wrote.
 *
 * Never throws — an exception here must not blow up a consumer's tooling;
 * failures downgrade to `console.warn`, same contract as {@link runInstall}.
 */
export async function runUninstall(): Promise<void> {
  try {
    const consumerRoot = findConsumerRoot();
    if (consumerRoot === null) {
      console.log(
        `${PACKAGE_NAME}: running from a toolkit checkout, nothing to uninstall.`,
      );
      return;
    }

    const manifestPath = path.join(consumerRoot, MANIFEST_RELPATH);
    if (!fs.existsSync(manifestPath)) {
      console.log(`${PACKAGE_NAME}: no manifest found, nothing to uninstall.`);
      return;
    }

    let files: string[];
    try {
      const manifest = JSON.parse(
        fs.readFileSync(manifestPath, "utf8"),
      ) as ToolkitManifest;
      if (!Array.isArray(manifest.files)) throw new Error("manifest has no files[]");
      files = manifest.files;
    } catch {
      console.warn(
        `${PACKAGE_NAME}: manifest unreadable — leaving all files in place.`,
      );
      return;
    }

    let removed = 0;

    for (const relPath of files) {
      const abs = path.join(consumerRoot, ...relPath.split("/"));

      if (relPath.startsWith(SKILLS_POSIX_PREFIX)) {
        let isLink = false;
        try {
          fs.readlinkSync(abs); // succeeds for a symlink/junction, even if broken
          isLink = true;
        } catch {
          isLink = false;
        }
        if (isLink) {
          fs.rmSync(abs, { recursive: true, force: true });
          removed++;
        } else if (fs.existsSync(abs)) {
          console.warn(
            `${PACKAGE_NAME}: "${relPath}" is not a link managed by this ` +
              `package — left in place.`,
          );
        }
        continue;
      }

      if (relPath === "CLAUDE.md") {
        if (!fs.existsSync(abs)) continue;
        const current = fs.readFileSync(abs, "utf8");
        const next = removeRulesBlock(current);
        if (next === null) {
          console.warn(
            `${PACKAGE_NAME}: CLAUDE.md has a malformed team-rules block ` +
              `(one marker without its pair) — left untouched.`,
          );
          continue;
        }
        if (next.trim() === "") {
          fs.rmSync(abs, { force: true });
          removed++;
        } else if (next !== current) {
          fs.writeFileSync(abs, next);
          removed++;
        }
        continue;
      }

      if (relPath === ".npmrc") {
        if (!fs.existsSync(abs)) continue;
        const current = fs.readFileSync(abs, "utf8");
        const next = removeNpmrcLines(current);
        if (next === "") {
          fs.rmSync(abs, { force: true });
          removed++;
        } else if (next !== current) {
          fs.writeFileSync(abs, next);
          removed++;
        }
        continue;
      }

      console.warn(
        `${PACKAGE_NAME}: unexpected manifest entry "${relPath}" — left in place.`,
      );
    }

    // Manifest first among the trailing cleanup: every file it lists has now
    // been handled, so an interrupt past this point leaves nothing stranded.
    fs.rmSync(manifestPath, { force: true });

    // Then remove managed directories we emptied — deepest first, guarded so a
    // directory the consumer still uses is left alone.
    for (const relDir of [SKILLS_RELDIR, ".claude"]) {
      const absDir = path.join(consumerRoot, relDir);
      try {
        if (fs.existsSync(absDir) && fs.readdirSync(absDir).length === 0) {
          fs.rmdirSync(absDir);
        }
      } catch {
        // Non-empty or racing with another process — nothing to clean up.
      }
    }

    console.log(
      `${PACKAGE_NAME}: uninstalled ${removed} file(s) from ${consumerRoot}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`${PACKAGE_NAME}: uninstall warning: ${message}`);
  }
}
