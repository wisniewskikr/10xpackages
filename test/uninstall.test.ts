import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runInstall } from "../src/install";
import { runUninstall } from "../src/uninstall";
import { PACKAGE_NAME, type ToolkitManifest } from "../src/manifest";

const MANIFEST_REL = join(".claude", ".ai-toolkit-manifest.json");
const SKILL_LINK_REL = join(".claude", "skills", "code-review");
const SKILL_LINK_POSIX = ".claude/skills/code-review";
const PAYLOAD_SKILL = join(__dirname, "..", "skills", "code-review");

const BEGIN = "<!-- BEGIN @wisniewskikr/ai-toolkit -->";
const END = "<!-- END @wisniewskikr/ai-toolkit -->";
const RULES_MARKER = "Prefer the smallest change that satisfies the request";
const REGISTRY_LINE = "@wisniewskikr:registry=https://npm.pkg.github.com";
const AUTH_LINE = "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}";

/** True when `s` has CRLF endings and no bare LF. */
function isPureCrlf(s: string): boolean {
  return !/[^\r]\n/.test(s) && s.includes("\r\n");
}

describe("runUninstall — manifest-driven removal (S-03)", () => {
  const originalProjectRoot = process.env.PROJECT_ROOT;
  const originalAuthToken = process.env.NODE_AUTH_TOKEN;
  let consumerRoot: string;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    consumerRoot = mkdtempSync(join(tmpdir(), "ai-toolkit-uninstall-"));
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

  /** Seed a manifest listing `files`, as if an install wrote it. */
  function seedManifest(files: string[]): void {
    const dir = join(consumerRoot, ".claude");
    mkdirSync(dir, { recursive: true });
    const manifest: ToolkitManifest = {
      package: PACKAGE_NAME,
      version: "0.1.0",
      tool: "claude-code",
      installedAt: "2026-01-01T00:00:00.000Z",
      files: [...files].sort(),
    };
    writeFileSync(
      join(dir, ".ai-toolkit-manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
  }

  function seedLink(relPosix: string): void {
    const linkPath = join(consumerRoot, ...relPosix.split("/"));
    mkdirSync(join(consumerRoot, ".claude", "skills"), { recursive: true });
    symlinkSync(
      PAYLOAD_SKILL,
      linkPath,
      process.platform === "win32" ? "junction" : "dir",
    );
  }

  it("round-trips: install then uninstall leaves no package trace", async () => {
    await runInstall();
    expect(existsSync(join(consumerRoot, SKILL_LINK_REL))).toBe(true);
    expect(existsSync(join(consumerRoot, MANIFEST_REL))).toBe(true);

    await runUninstall();

    expect(existsSync(join(consumerRoot, SKILL_LINK_REL))).toBe(false);
    expect(existsSync(join(consumerRoot, MANIFEST_REL))).toBe(false);
    expect(existsSync(join(consumerRoot, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(consumerRoot, ".npmrc"))).toBe(false);
    expect(existsSync(join(consumerRoot, ".claude"))).toBe(false);

    // A second uninstall is a clean no-op.
    await expect(runUninstall()).resolves.toBeUndefined();
  });

  it("keeps hand-written CLAUDE.md content, removing only the block", async () => {
    const seed = "# Mine\n\nkeep this\n";
    writeFileSync(join(consumerRoot, "CLAUDE.md"), seed);

    await runInstall();
    expect(readFileSync(join(consumerRoot, "CLAUDE.md"), "utf8")).toContain(BEGIN);

    await runUninstall();

    expect(readFileSync(join(consumerRoot, "CLAUDE.md"), "utf8")).toBe(seed);
  });

  it("keeps an unrelated .npmrc entry and does not delete the file", async () => {
    writeFileSync(
      join(consumerRoot, ".npmrc"),
      "@other:registry=https://example.com/\n",
    );

    await runInstall();
    await runUninstall();

    const npmrc = readFileSync(join(consumerRoot, ".npmrc"), "utf8");
    expect(npmrc).toContain("@other:registry=https://example.com/");
    expect(npmrc).not.toContain(REGISTRY_LINE);
    expect(npmrc).not.toContain("_authToken");
  });

  it("removes the ${NODE_AUTH_TOKEN} credential line too", async () => {
    process.env.NODE_AUTH_TOKEN = "sentinel";
    await runInstall();
    expect(readFileSync(join(consumerRoot, ".npmrc"), "utf8")).toContain(
      AUTH_LINE,
    );

    await runUninstall();

    expect(existsSync(join(consumerRoot, ".npmrc"))).toBe(false);
  });

  it("strips the block from a CRLF CLAUDE.md, preserving surrounding text and endings", async () => {
    writeFileSync(
      join(consumerRoot, "CLAUDE.md"),
      `# Header keep me\r\n\r\n${BEGIN}\r\nOLD\r\n${END}\r\n\r\n## Footer keep me too\r\n`,
    );

    await runInstall(); // S-02 keeps CRLF while refreshing the block
    await runUninstall();

    const out = readFileSync(join(consumerRoot, "CLAUDE.md"), "utf8");
    expect(out).toContain("# Header keep me");
    expect(out).toContain("## Footer keep me too");
    expect(out).not.toContain(BEGIN);
    expect(out).not.toContain(RULES_MARKER);
    expect(isPureCrlf(out)).toBe(true);
  });

  it("leaves a malformed rules block untouched and warns", async () => {
    const warn = vi.spyOn(console, "warn");
    const seed = `# Mine\n\n${BEGIN}\nhalf a block, no END\n`;
    writeFileSync(join(consumerRoot, "CLAUDE.md"), seed);
    seedManifest(["CLAUDE.md"]);

    await runUninstall();

    expect(readFileSync(join(consumerRoot, "CLAUDE.md"), "utf8")).toBe(seed);
    expect(warn).toHaveBeenCalled();
    const message = warn.mock.calls.flat().join(" ");
    expect(message).toMatch(/CLAUDE\.md:3\b/);
    expect(message).toContain("corrupted");
    expect(existsSync(join(consumerRoot, MANIFEST_REL))).toBe(false);
  });

  it("warns and removes nothing when the manifest is unreadable", async () => {
    const warn = vi.spyOn(console, "warn");
    mkdirSync(join(consumerRoot, ".claude"), { recursive: true });
    writeFileSync(join(consumerRoot, MANIFEST_REL), "{ not json");
    seedLink(SKILL_LINK_POSIX);

    await runUninstall();

    expect(warn).toHaveBeenCalled();
    expect(existsSync(join(consumerRoot, SKILL_LINK_REL))).toBe(true);
    expect(existsSync(join(consumerRoot, MANIFEST_REL))).toBe(true);
  });

  it("lists manual-cleanup candidates on a corrupt manifest and deletes nothing", async () => {
    const warn = vi.spyOn(console, "warn");
    mkdirSync(join(consumerRoot, ".claude"), { recursive: true });
    writeFileSync(join(consumerRoot, MANIFEST_REL), "{ not json");
    seedLink(SKILL_LINK_POSIX);
    writeFileSync(
      join(consumerRoot, "CLAUDE.md"),
      `# mine\n\n${BEGIN}\nrules\n${END}\n`,
    );
    writeFileSync(join(consumerRoot, ".npmrc"), `${REGISTRY_LINE}\n`);

    await runUninstall();

    const message = warn.mock.calls.flat().join("\n");
    expect(message).toContain(SKILL_LINK_POSIX);
    expect(message).toContain("CLAUDE.md");
    expect(message).toContain(".npmrc");
    expect(message).toContain(".claude/.ai-toolkit-manifest.json");

    // Nothing was removed.
    expect(existsSync(join(consumerRoot, SKILL_LINK_REL))).toBe(true);
    expect(existsSync(join(consumerRoot, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(consumerRoot, ".npmrc"))).toBe(true);
    expect(existsSync(join(consumerRoot, MANIFEST_REL))).toBe(true);
  });

  it("leaves a manifest skill path that is a real directory, and warns", async () => {
    const warn = vi.spyOn(console, "warn");
    seedManifest([".claude/skills/mine", SKILL_LINK_POSIX]);
    seedLink(SKILL_LINK_POSIX);
    const realDir = join(consumerRoot, ".claude", "skills", "mine");
    mkdirSync(realDir, { recursive: true });
    writeFileSync(join(realDir, "SKILL.md"), "# my own skill\n");

    await runUninstall();

    expect(statSync(realDir).isDirectory()).toBe(true);
    expect(readFileSync(join(realDir, "SKILL.md"), "utf8")).toBe(
      "# my own skill\n",
    );
    expect(warn).toHaveBeenCalled();
    expect(existsSync(join(consumerRoot, SKILL_LINK_REL))).toBe(false);
    expect(existsSync(join(consumerRoot, MANIFEST_REL))).toBe(false);
  });

  it("is a no-op when there is no manifest", async () => {
    const warn = vi.spyOn(console, "warn");

    await expect(runUninstall()).resolves.toBeUndefined();

    // No manifest at all = nothing was installed = no candidate list.
    const message = warn.mock.calls.flat().join("\n");
    expect(message).not.toContain("Candidates for manual cleanup");
  });

  it("keeps .claude/ when the consumer keeps their own files there", async () => {
    seedManifest([SKILL_LINK_POSIX]);
    seedLink(SKILL_LINK_POSIX);
    writeFileSync(join(consumerRoot, ".claude", "settings.json"), "{}\n");

    await runUninstall();

    expect(existsSync(join(consumerRoot, ".claude"))).toBe(true);
    expect(existsSync(join(consumerRoot, ".claude", "settings.json"))).toBe(true);
    expect(existsSync(join(consumerRoot, ".claude", "skills"))).toBe(false);
    expect(existsSync(join(consumerRoot, MANIFEST_REL))).toBe(false);
  });
});

describe("runUninstall — standalone copy mode (S-04)", () => {
  const originalProjectRoot = process.env.PROJECT_ROOT;
  const originalAuthToken = process.env.NODE_AUTH_TOKEN;
  let consumerRoot: string;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    consumerRoot = mkdtempSync(join(tmpdir(), "ai-toolkit-uninstall-"));
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

  function seedManifest(files: string[]): void {
    const dir = join(consumerRoot, ".claude");
    mkdirSync(dir, { recursive: true });
    const manifest: ToolkitManifest = {
      package: PACKAGE_NAME,
      version: "0.1.0",
      tool: "claude-code",
      installedAt: "2026-01-01T00:00:00.000Z",
      files: [...files].sort(),
    };
    writeFileSync(
      join(dir, ".ai-toolkit-manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
  }

  it("round-trips: copy install then uninstall leaves no package trace", async () => {
    await runInstall({ copy: true });
    const skillFile = join(consumerRoot, SKILL_LINK_REL, "SKILL.md");
    expect(existsSync(skillFile)).toBe(true);

    await runUninstall();

    expect(existsSync(join(consumerRoot, ".claude"))).toBe(false);
    expect(existsSync(join(consumerRoot, MANIFEST_REL))).toBe(false);
    expect(existsSync(join(consumerRoot, "CLAUDE.md"))).toBe(false);
    await expect(runUninstall()).resolves.toBeUndefined();
  });

  it("keeps hand-written CLAUDE.md content after a copy round-trip", async () => {
    const seed = "# Mine\n\nkeep this\n";
    writeFileSync(join(consumerRoot, "CLAUDE.md"), seed);

    await runInstall({ copy: true });
    await runUninstall();

    expect(readFileSync(join(consumerRoot, "CLAUDE.md"), "utf8")).toBe(seed);
  });

  it("removes a nested copied skill tree and prunes the emptied directories", async () => {
    const nested = [
      ".claude/skills/deep/a/b.md",
      ".claude/skills/deep/c.md",
    ];
    for (const rel of nested) {
      const abs = join(consumerRoot, ...rel.split("/"));
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, "x\n");
    }
    seedManifest(nested);

    await runUninstall();

    expect(existsSync(join(consumerRoot, ".claude", "skills", "deep"))).toBe(
      false,
    );
    expect(existsSync(join(consumerRoot, ".claude"))).toBe(false);
    expect(existsSync(join(consumerRoot, MANIFEST_REL))).toBe(false);
  });
});
