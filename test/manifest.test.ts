import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  PACKAGE_NAME,
  PACKAGE_VERSION,
  SENTINEL_BEGIN,
  SENTINEL_END,
  type ToolkitManifest,
} from "../src/manifest";

describe("sentinel markers", () => {
  it("both contain the package name", () => {
    expect(SENTINEL_BEGIN).toContain(PACKAGE_NAME);
    expect(SENTINEL_END).toContain(PACKAGE_NAME);
  });

  it("are distinct and non-empty", () => {
    expect(SENTINEL_BEGIN).not.toEqual(SENTINEL_END);
    expect(SENTINEL_BEGIN.length).toBeGreaterThan(0);
    expect(SENTINEL_END.length).toBeGreaterThan(0);
  });

  it("are HTML comments so they survive in a Markdown rules file", () => {
    expect(SENTINEL_BEGIN).toMatch(/^<!--.*-->$/);
    expect(SENTINEL_END).toMatch(/^<!--.*-->$/);
  });
});

describe("ToolkitManifest contract", () => {
  it("round-trips through JSON without losing fields", () => {
    const manifest: ToolkitManifest = {
      package: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      tool: "claude-code",
      installedAt: "2026-08-28T00:00:00.000Z",
      files: [".claude/skills/code-review/SKILL.md", "CLAUDE.md"],
    };

    const parsed = JSON.parse(JSON.stringify(manifest)) as ToolkitManifest;

    expect(parsed).toEqual(manifest);
    expect(parsed.files).toHaveLength(2);
  });
});

describe("version drift guard", () => {
  it("PACKAGE_VERSION matches package.json#version", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };

    expect(PACKAGE_VERSION).toBe(pkg.version);
  });

  it("PACKAGE_NAME matches package.json#name", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { name: string };

    expect(PACKAGE_NAME).toBe(pkg.name);
  });
});
