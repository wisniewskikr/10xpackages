import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
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
  it("ships dist, skills, rules, bin, and the README", () => {
    for (const entry of ["dist/", "skills/", "rules/", "bin/", "README.md"]) {
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

  it("excludes sources, tests, and context docs", () => {
    for (const path of paths) {
      expect(path.startsWith("src/")).toBe(false);
      expect(path.startsWith("test/")).toBe(false);
      expect(path.startsWith("context/")).toBe(false);
    }
  });
});
