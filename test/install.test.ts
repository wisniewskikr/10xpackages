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

const BEGIN = "<!-- BEGIN @10xpackages/ai-toolkit -->";
const END = "<!-- END @10xpackages/ai-toolkit -->";
// A stable sentence from the shipped rules/CLAUDE.md payload.
const RULES_MARKER = "Prefer the smallest change that satisfies the request";

describe("runInstall — team rules block (Phase 2)", () => {
  const originalProjectRoot = process.env.PROJECT_ROOT;
  let consumerRoot: string;
  let claudeMd: string;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    consumerRoot = mkdtempSync(join(tmpdir(), "ai-toolkit-consumer-"));
    process.env.PROJECT_ROOT = consumerRoot;
    claudeMd = join(consumerRoot, "CLAUDE.md");
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

  function countOccurrences(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
  }

  it("creates CLAUDE.md containing only the fenced block when none exists", async () => {
    await runInstall();

    const content = readFileSync(claudeMd, "utf8");
    expect(content.startsWith(BEGIN)).toBe(true);
    expect(content.trimEnd().endsWith(END)).toBe(true);
    expect(content).toContain(RULES_MARKER);
    expect(readManifest().files).toContain("CLAUDE.md");
  });

  it("appends the block below hand-written content and is byte-identical on re-run", async () => {
    writeFileSync(claudeMd, "# My rules\n\nkeep this line\n");

    await runInstall();
    const afterFirst = readFileSync(claudeMd, "utf8");
    expect(afterFirst).toContain("keep this line");
    expect(afterFirst).toContain(BEGIN);
    expect(countOccurrences(afterFirst, BEGIN)).toBe(1);

    await runInstall();
    expect(readFileSync(claudeMd, "utf8")).toBe(afterFirst);
  });

  it("replaces the block between existing markers, leaving surrounding text intact", async () => {
    writeFileSync(
      claudeMd,
      `# Header keep me\n\n${BEGIN}\nOLD TEAM RULES\n${END}\n\n## Footer keep me too\n`,
    );

    await runInstall();

    const content = readFileSync(claudeMd, "utf8");
    expect(content).toContain("# Header keep me");
    expect(content).toContain("## Footer keep me too");
    expect(content).not.toContain("OLD TEAM RULES");
    expect(content).toContain(RULES_MARKER);
    expect(countOccurrences(content, BEGIN)).toBe(1);
    expect(countOccurrences(content, END)).toBe(1);
  });

  it("skips a malformed block (single marker) without corrupting the file", async () => {
    const warn = vi.spyOn(console, "warn");
    const seeded = `# Mine\n\n${BEGIN}\nhalf a block, no END\n`;
    writeFileSync(claudeMd, seeded);

    await runInstall();

    expect(readFileSync(claudeMd, "utf8")).toBe(seeded);
    expect(countOccurrences(readFileSync(claudeMd, "utf8"), BEGIN)).toBe(1);
    expect(warn).toHaveBeenCalled();
    expect(readManifest().files).not.toContain("CLAUDE.md");
  });
});

const REGISTRY_LINE = "@10xpackages:registry=https://npm.pkg.github.com";
const AUTH_LINE = "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}";

describe("runInstall — .npmrc registry line + conditional credential (Phase 3)", () => {
  const originalProjectRoot = process.env.PROJECT_ROOT;
  const originalAuthToken = process.env.NODE_AUTH_TOKEN;
  let consumerRoot: string;
  let npmrc: string;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    consumerRoot = mkdtempSync(join(tmpdir(), "ai-toolkit-consumer-"));
    process.env.PROJECT_ROOT = consumerRoot;
    delete process.env.NODE_AUTH_TOKEN;
    npmrc = join(consumerRoot, ".npmrc");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(consumerRoot, { recursive: true, force: true });
    if (originalProjectRoot === undefined) delete process.env.PROJECT_ROOT;
    else process.env.PROJECT_ROOT = originalProjectRoot;
    if (originalAuthToken === undefined) delete process.env.NODE_AUTH_TOKEN;
    else process.env.NODE_AUTH_TOKEN = originalAuthToken;
  });

  function readManifest(): ToolkitManifest {
    return JSON.parse(
      readFileSync(join(consumerRoot, MANIFEST_REL), "utf8"),
    ) as ToolkitManifest;
  }

  it("creates .npmrc with the scope→registry line when none exists", async () => {
    await runInstall();

    expect(readFileSync(npmrc, "utf8")).toBe(REGISTRY_LINE + "\n");
    expect(readManifest().files).toContain(".npmrc");
  });

  it("appends only the missing line, leaving an unrelated registry entry intact", async () => {
    writeFileSync(npmrc, "@other:registry=https://example.com/\n");

    await runInstall();

    const content = readFileSync(npmrc, "utf8");
    expect(content).toContain("@other:registry=https://example.com/");
    expect(content).toContain(REGISTRY_LINE);

    await runInstall();
    expect(readFileSync(npmrc, "utf8")).toBe(content); // no duplicate on re-run
  });

  it("writes the ${NODE_AUTH_TOKEN} reference — never the token value — when the env var is set", async () => {
    process.env.NODE_AUTH_TOKEN = "s3cr3t-sentinel-value";

    await runInstall();

    const content = readFileSync(npmrc, "utf8");
    expect(content).toContain(AUTH_LINE);
    expect(content).not.toContain("s3cr3t-sentinel-value");
  });

  it("omits the credential line and still completes when NODE_AUTH_TOKEN is unset", async () => {
    await expect(runInstall()).resolves.toBeUndefined();
    expect(readFileSync(npmrc, "utf8")).not.toContain("_authToken");
  });
});
