import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface PackEntry {
  path: string;
}

interface PackResult {
  files: PackEntry[];
}

function packedPaths(): string[] {
  const raw = execSync("npm pack --dry-run --json", {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  const parsed = JSON.parse(raw) as PackResult[];
  return parsed[0].files.map((entry) => entry.path.replace(/\\/g, "/"));
}

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { files: string[] };

describe("package.json files allowlist", () => {
  it("ships dist, skills, rules, bin, the workflow, and the README", () => {
    for (const entry of [
      "dist/",
      "skills/",
      "rules/",
      "bin/",
      ".github/",
      "README.md",
    ]) {
      expect(pkg.files).toContain(entry);
    }
  });
});

describe("payload files", () => {
  it("skills/code-review/SKILL.md exists and is non-empty", () => {
    expect(statSync("skills/code-review/SKILL.md").size).toBeGreaterThan(0);
  });

  it("rules/CLAUDE.md exists and is non-empty", () => {
    expect(statSync("rules/CLAUDE.md").size).toBeGreaterThan(0);
  });

  it("no payload file contains the sentinel marker strings", () => {
    const skill = readFileSync("skills/code-review/SKILL.md", "utf8");
    const rules = readFileSync("rules/CLAUDE.md", "utf8");
    for (const content of [skill, rules]) {
      expect(content).not.toContain("<!-- BEGIN @10xpackages/ai-toolkit -->");
      expect(content).not.toContain("<!-- END @10xpackages/ai-toolkit -->");
    }
  });
});

describe("npm pack contents", () => {
  const paths = packedPaths();

  it("includes the payload and the built CLI", () => {
    expect(paths).toContain("skills/code-review/SKILL.md");
    expect(paths).toContain("rules/CLAUDE.md");
    expect(paths).toContain("dist/cli.js");
  });

  it("ships the publish pipeline definition (US-01 AC)", () => {
    expect(paths).toContain(".github/workflows/publish-ai-toolkit.yml");
  });

  it("excludes sources, tests, context docs, .claude, and the consumer-CI example", () => {
    for (const path of paths) {
      expect(path.startsWith("src/")).toBe(false);
      expect(path.startsWith("test/")).toBe(false);
      expect(path.startsWith("context/")).toBe(false);
      expect(path.startsWith(".claude/")).toBe(false);
      expect(path.startsWith("examples/")).toBe(false);
    }
  });
});

describe("shipped skills", () => {
  const skillDirs = readdirSync("skills", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  it("has at least one skill", () => {
    expect(skillDirs.length).toBeGreaterThan(0);
  });

  for (const dir of skillDirs) {
    it(`skills/${dir}/SKILL.md has name + description frontmatter, name matches the directory`, () => {
      const raw = readFileSync(`skills/${dir}/SKILL.md`, "utf8");
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
      expect(fm, "SKILL.md must open with a YAML frontmatter block").not.toBeNull();
      const body = fm![1];
      const name = /^name:\s*(.+?)\s*$/m.exec(body)?.[1];
      const description = /^description:\s*(.+?)\s*$/m.exec(body)?.[1];
      expect(name, "frontmatter needs a non-empty name").toBeTruthy();
      expect(description, "frontmatter needs a non-empty description").toBeTruthy();
      expect(name).toBe(dir);
    });
  }
});
