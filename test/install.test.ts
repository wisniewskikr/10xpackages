import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
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

const LEGACY_LINK_REL = join(".claude", "skills", "legacy-thing");
const LEGACY_LINK_POSIX = ".claude/skills/legacy-thing";

describe("runInstall — withdrawn-artifact reconcile (S-02)", () => {
  const originalProjectRoot = process.env.PROJECT_ROOT;
  const originalAuthToken = process.env.NODE_AUTH_TOKEN;
  let consumerRoot: string;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    consumerRoot = mkdtempSync(join(tmpdir(), "ai-toolkit-consumer-"));
    process.env.PROJECT_ROOT = consumerRoot;
    delete process.env.NODE_AUTH_TOKEN;
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

  /** Seed a prior-version manifest listing `files`, as if an older install wrote it. */
  function seedManifest(files: string[]): void {
    const dir = join(consumerRoot, ".claude");
    mkdirSync(dir, { recursive: true });
    const manifest: ToolkitManifest = {
      package: PACKAGE_NAME,
      version: "0.0.9",
      tool: "claude-code",
      installedAt: "2020-01-01T00:00:00.000Z",
      files: [...files].sort(),
    };
    writeFileSync(
      join(dir, ".ai-toolkit-manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
  }

  /** Create `.claude/skills/legacy-thing` as a junction/symlink into the payload. */
  function seedLegacyLink(): void {
    const linkPath = join(consumerRoot, LEGACY_LINK_REL);
    mkdirSync(join(consumerRoot, ".claude", "skills"), { recursive: true });
    symlinkSync(
      PAYLOAD_SKILL,
      linkPath,
      process.platform === "win32" ? "junction" : "dir",
    );
  }

  it("removes a withdrawn skill link and keeps the shipped one", async () => {
    seedManifest([SKILL_LINK_POSIX, LEGACY_LINK_POSIX, "CLAUDE.md", ".npmrc"]);
    seedLegacyLink();

    await runInstall();

    expect(existsSync(join(consumerRoot, LEGACY_LINK_REL))).toBe(false);
    const kept = join(consumerRoot, SKILL_LINK_REL);
    expect(existsSync(kept)).toBe(true);
    expect(realpathSync(kept)).toBe(realpathSync(PAYLOAD_SKILL));
    expect(readManifest().files).not.toContain(LEGACY_LINK_POSIX);
    expect(readManifest().files).toContain(SKILL_LINK_POSIX);
  });

  it("leaves a withdrawn entry that is now a real directory, and warns", async () => {
    const warn = vi.spyOn(console, "warn");
    seedManifest([SKILL_LINK_POSIX, LEGACY_LINK_POSIX]);
    const realDir = join(consumerRoot, LEGACY_LINK_REL);
    mkdirSync(realDir, { recursive: true });
    writeFileSync(join(realDir, "SKILL.md"), "# consumer's own skill\n");

    await runInstall();

    expect(statSync(realDir).isDirectory()).toBe(true);
    expect(readFileSync(join(realDir, "SKILL.md"), "utf8")).toBe(
      "# consumer's own skill\n",
    );
    expect(warn).toHaveBeenCalled();
    expect(readManifest().files).not.toContain(LEGACY_LINK_POSIX);
  });

  it("never removes CLAUDE.md even when it drops out of the current file set", async () => {
    // A malformed sentinel block makes applyRulesBlock warn+skip, so "CLAUDE.md"
    // is absent from currentFiles — it must still not be treated as withdrawn.
    const claudeMd = join(consumerRoot, "CLAUDE.md");
    const seeded = `# mine\n\n${BEGIN}\nhalf a block, no END\n`;
    writeFileSync(claudeMd, seeded);
    seedManifest([SKILL_LINK_POSIX, "CLAUDE.md"]);

    await runInstall();

    expect(existsSync(claudeMd)).toBe(true);
    expect(readFileSync(claudeMd, "utf8")).toBe(seeded);
  });

  it("is a no-op when there is no prior manifest", async () => {
    await expect(runInstall()).resolves.toBeUndefined();
    expect(existsSync(join(consumerRoot, SKILL_LINK_REL))).toBe(true);
  });

  it("warns and still runs the forward reconcile when the prior manifest is corrupt", async () => {
    const warn = vi.spyOn(console, "warn");
    mkdirSync(join(consumerRoot, ".claude"), { recursive: true });
    writeFileSync(
      join(consumerRoot, MANIFEST_REL),
      "{ this is not valid json",
    );

    await runInstall();

    expect(warn).toHaveBeenCalled();
    expect(existsSync(join(consumerRoot, SKILL_LINK_REL))).toBe(true);
    const m = readManifest();
    expect(m.package).toBe(PACKAGE_NAME);
    expect(m.version).toBe(PACKAGE_VERSION);
  });

  it("keeps .claude/skills/ when a shipped skill still lives there after pruning", async () => {
    seedManifest([SKILL_LINK_POSIX, LEGACY_LINK_POSIX]);
    seedLegacyLink();

    await runInstall();

    const skillsDir = join(consumerRoot, ".claude", "skills");
    expect(existsSync(skillsDir)).toBe(true);
    expect(readdirSync(skillsDir)).toContain("code-review");
    expect(readdirSync(skillsDir)).not.toContain("legacy-thing");
  });
});

/** True when `s` contains no bare LF (every `\n` is preceded by `\r`). */
function isPureCrlf(s: string): boolean {
  return !/[^\r]\n/.test(s) && s.includes("\r\n");
}

describe("runInstall — CRLF consumer repos (S-02)", () => {
  const originalProjectRoot = process.env.PROJECT_ROOT;
  const originalAuthToken = process.env.NODE_AUTH_TOKEN;
  let consumerRoot: string;
  let claudeMd: string;
  let npmrc: string;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    consumerRoot = mkdtempSync(join(tmpdir(), "ai-toolkit-consumer-"));
    process.env.PROJECT_ROOT = consumerRoot;
    delete process.env.NODE_AUTH_TOKEN;
    claudeMd = join(consumerRoot, "CLAUDE.md");
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

  it("keeps CRLF CLAUDE.md byte-identical across a second run (block already present)", async () => {
    writeFileSync(
      claudeMd,
      `# Header keep me\r\n\r\n${BEGIN}\r\nOLD TEAM RULES\r\n${END}\r\n\r\n## Footer keep me too\r\n`,
    );

    await runInstall();
    const afterFirst = readFileSync(claudeMd, "utf8");
    expect(isPureCrlf(afterFirst)).toBe(true);
    expect(afterFirst).toContain(RULES_MARKER);
    expect(afterFirst).toContain("# Header keep me");
    expect(afterFirst).toContain("## Footer keep me too");
    expect(afterFirst).not.toContain("OLD TEAM RULES");

    await runInstall();
    expect(readFileSync(claudeMd, "utf8")).toBe(afterFirst);
  });

  it("appends the block to a CRLF CLAUDE.md with no markers, then is byte-identical on re-run", async () => {
    writeFileSync(claudeMd, "# My rules\r\n\r\nkeep this line\r\n");

    await runInstall();
    const afterFirst = readFileSync(claudeMd, "utf8");
    expect(afterFirst).toContain("keep this line");
    expect(afterFirst.split(BEGIN).length - 1).toBe(1);
    expect(isPureCrlf(afterFirst)).toBe(true);

    await runInstall();
    expect(readFileSync(claudeMd, "utf8")).toBe(afterFirst);
  });

  it("does not rewrite a CRLF .npmrc that already carries the registry line", async () => {
    const seeded = `@other:registry=https://example.com/\r\n${REGISTRY_LINE}\r\n`;
    writeFileSync(npmrc, seeded);

    await runInstall();

    expect(readFileSync(npmrc, "utf8")).toBe(seeded);
  });

  it("appends the missing line to a CRLF .npmrc while preserving its endings", async () => {
    writeFileSync(npmrc, "@other:registry=https://example.com/\r\n");

    await runInstall();
    const afterFirst = readFileSync(npmrc, "utf8");
    expect(afterFirst).toContain(REGISTRY_LINE);
    expect(afterFirst).toContain("@other:registry=https://example.com/");
    expect(isPureCrlf(afterFirst)).toBe(true);

    await runInstall();
    expect(readFileSync(npmrc, "utf8")).toBe(afterFirst);
  });
});

describe("runInstall — standalone copy mode (S-04)", () => {
  const originalProjectRoot = process.env.PROJECT_ROOT;
  const originalAuthToken = process.env.NODE_AUTH_TOKEN;
  let consumerRoot: string;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    consumerRoot = mkdtempSync(join(tmpdir(), "ai-toolkit-consumer-"));
    process.env.PROJECT_ROOT = consumerRoot;
    delete process.env.NODE_AUTH_TOKEN;
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

  it("copies each skill as real files (not symlinks) equal to the payload", async () => {
    await runInstall({ copy: true });

    const skillDir = join(consumerRoot, SKILL_LINK_REL);
    const skillFile = join(skillDir, "SKILL.md");
    expect(existsSync(skillFile)).toBe(true);
    expect(lstatSync(skillDir).isSymbolicLink()).toBe(false);
    expect(lstatSync(skillFile).isSymbolicLink()).toBe(false);
    expect(readFileSync(skillFile)).toEqual(
      readFileSync(join(PAYLOAD_SKILL, "SKILL.md")),
    );
  });

  it("records per-file manifest entries, sorted", async () => {
    await runInstall({ copy: true });

    const files = readManifest().files;
    expect(files).toContain(`${SKILL_LINK_POSIX}/SKILL.md`);
    expect(files).not.toContain(SKILL_LINK_POSIX); // bare dir = link-mode shape
    expect(files).toContain("CLAUDE.md");
    expect([...files]).toEqual([...files].sort());
  });

  it("is idempotent — a second copy run rewrites nothing", async () => {
    await runInstall({ copy: true });
    const skillFile = join(consumerRoot, SKILL_LINK_REL, "SKILL.md");
    const manifestPath = join(consumerRoot, MANIFEST_REL);
    const skillBytes = readFileSync(skillFile);
    const manifestBytes = readFileSync(manifestPath, "utf8");
    const skillMtime = statSync(skillFile).mtimeMs;

    await new Promise((resolve) => setTimeout(resolve, 15));
    await runInstall({ copy: true });

    expect(readFileSync(skillFile)).toEqual(skillBytes);
    expect(readFileSync(manifestPath, "utf8")).toBe(manifestBytes);
    expect(statSync(skillFile).mtimeMs).toBe(skillMtime);
  });

  it("skips a pre-existing unmanaged skill directory and warns", async () => {
    const warn = vi.spyOn(console, "warn");
    const mine = join(consumerRoot, SKILL_LINK_REL, "SKILL.md");
    mkdirSync(join(consumerRoot, SKILL_LINK_REL), { recursive: true });
    writeFileSync(mine, "# mine\n");

    await runInstall({ copy: true });

    expect(readFileSync(mine, "utf8")).toBe("# mine\n");
    expect(warn).toHaveBeenCalled();
    expect(readManifest().files).not.toContain(`${SKILL_LINK_POSIX}/SKILL.md`);
  });

  it("writes no .npmrc when the project has no package.json", async () => {
    await runInstall({ copy: true });

    expect(existsSync(join(consumerRoot, ".npmrc"))).toBe(false);
    expect(readManifest().files).not.toContain(".npmrc");
  });

  it("still writes .npmrc when a package.json is present", async () => {
    writeFileSync(
      join(consumerRoot, "package.json"),
      '{ "name": "consumer-app" }\n',
    );

    await runInstall({ copy: true });

    expect(readFileSync(join(consumerRoot, ".npmrc"), "utf8")).toContain(
      REGISTRY_LINE,
    );
    expect(readManifest().files).toContain(".npmrc");
  });

  it("leaves the default (non-copy) run producing the dir-level link entry", async () => {
    await runInstall();

    const files = readManifest().files;
    expect(files).toContain(SKILL_LINK_POSIX);
    expect(files).not.toContain(`${SKILL_LINK_POSIX}/SKILL.md`);
  });

  it("prunes a withdrawn copied file and its emptied directory on re-install", async () => {
    const legacyRel = ".claude/skills/legacy/OLD.md";
    const legacyAbs = join(consumerRoot, ...legacyRel.split("/"));
    mkdirSync(join(legacyAbs, ".."), { recursive: true });
    writeFileSync(legacyAbs, "stale\n");

    const priorManifest: ToolkitManifest = {
      package: PACKAGE_NAME,
      version: "0.0.9",
      tool: "claude-code",
      installedAt: "2020-01-01T00:00:00.000Z",
      files: [`${SKILL_LINK_POSIX}/SKILL.md`, legacyRel, "CLAUDE.md"].sort(),
    };
    mkdirSync(join(consumerRoot, ".claude"), { recursive: true });
    writeFileSync(
      join(consumerRoot, MANIFEST_REL),
      JSON.stringify(priorManifest, null, 2) + "\n",
    );

    await runInstall({ copy: true });

    expect(existsSync(legacyAbs)).toBe(false);
    expect(existsSync(join(consumerRoot, ".claude", "skills", "legacy"))).toBe(
      false,
    );
    expect(existsSync(join(consumerRoot, SKILL_LINK_REL, "SKILL.md"))).toBe(true);
    expect(readManifest().files).not.toContain(legacyRel);
  });
});
