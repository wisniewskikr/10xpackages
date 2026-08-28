import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runInstall } from "../src/install";
import { runUninstall } from "../src/uninstall";

describe("stub entrypoints", () => {
  const originalProjectRoot = process.env.PROJECT_ROOT;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalProjectRoot === undefined) {
      delete process.env.PROJECT_ROOT;
    } else {
      process.env.PROJECT_ROOT = originalProjectRoot;
    }
  });

  it("runInstall resolves without throwing when PROJECT_ROOT is unset", async () => {
    delete process.env.PROJECT_ROOT;
    await expect(runInstall()).resolves.toBeUndefined();
  });

  it("runInstall resolves without throwing when PROJECT_ROOT points at a temp dir", async () => {
    process.env.PROJECT_ROOT = mkdtempSync(join(tmpdir(), "ai-toolkit-"));
    await expect(runInstall()).resolves.toBeUndefined();
  });

  it("runUninstall resolves without throwing", async () => {
    await expect(runUninstall()).resolves.toBeUndefined();
  });
});
