import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runInstall } from "../src/install";
import {
  PACKAGE_NAME,
  PACKAGE_VERSION,
  type ToolkitManifest,
} from "../src/manifest";

const MANIFEST_REL = join(".claude", ".ai-toolkit-manifest.json");
const SKILL_LINK_REL = join(".claude", "skills", "code-review");
const SKILL_LINK_POSIX = ".claude/skills/code-review";
const PAYLOAD_SKILL = join(__dirname, "..", "skills", "code-review");

describe("runInstall — skills + manifest (Phase 1)", () => {
  const originalProjectRoot = process.env.PROJECT_ROOT;
  let consumerRoot: string;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    consumerRoot = mkdtempSync(join(tmpdir(), "ai-toolkit-consumer-"));
    process.env.PROJECT_ROOT = consumerRoot;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(consumerRoot, { recursive: true, force: true });
    if (originalProjectRoot === undefined) {
      delete process.env.PROJECT_ROOT;
    } else {
      process.env.PROJECT_ROOT = originalProjectRoot;
    }
  });

  function readManifest(): ToolkitManifest {
    return JSON.parse(
      readFileSync(join(consumerRoot, MANIFEST_REL), "utf8"),
    ) as ToolkitManifest;
  }

  it("links each shipped skill into .claude/skills, resolving to the payload", async () => {
    await runInstall();

    const linkPath = join(consumerRoot, SKILL_LINK_REL);
    expect(existsSync(linkPath)).toBe(true);
    expect(realpathSync(linkPath)).toBe(realpathSync(PAYLOAD_SKILL));
    expect(existsSync(join(linkPath, "SKILL.md"))).toBe(true);
  });

  it("writes a well-formed manifest with all five fields", async () => {
    await runInstall();

    const m = readManifest();
    expect(m.package).toBe(PACKAGE_NAME);
    expect(m.version).toBe(PACKAGE_VERSION);
    expect(m.tool).toBe("claude-code");
    expect(typeof m.installedAt).toBe("string");
    expect(m.files).toContain(SKILL_LINK_POSIX);
    expect([...m.files]).toEqual([...m.files].sort());
  });

  it("is idempotent — a second run leaves the manifest byte-identical", async () => {
    await runInstall();
    const manifestPath = join(consumerRoot, MANIFEST_REL);
    const firstBytes = readFileSync(manifestPath, "utf8");
    const firstMtime = statSync(manifestPath).mtimeMs;

    await new Promise((resolve) => setTimeout(resolve, 15));
    await runInstall();

    expect(readFileSync(manifestPath, "utf8")).toBe(firstBytes);
    expect(statSync(manifestPath).mtimeMs).toBe(firstMtime);
  });

  it("skips a pre-existing real skill directory (collision) and warns", async () => {
    const warn = vi.spyOn(console, "warn");
    const realDir = join(consumerRoot, SKILL_LINK_REL);
    mkdirSync(realDir, { recursive: true });
    writeFileSync(join(realDir, "SKILL.md"), "# my own skill\n");

    await runInstall();

    expect(readFileSync(join(realDir, "SKILL.md"), "utf8")).toBe(
      "# my own skill\n",
    );
    expect(statSync(realDir).isDirectory()).toBe(true);
    expect(warn).toHaveBeenCalled();
    expect(readManifest().files).not.toContain(SKILL_LINK_POSIX);
  });
});
