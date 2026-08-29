import { execSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildRulesBlock } from "../src/install";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../src/manifest";

/**
 * Registry round trip (S-07). Proves the publish→consume loop closes against the
 * *real packed artifact*: `npm pack` the package, then `npm install` the tarball
 * into a throwaway consumer project so npm runs the actual `postinstall` →
 * `ai-toolkit install` through the real `node_modules` walk — the path no
 * `PROJECT_ROOT`-based unit test exercises.
 *
 * The live private registry and its credentials are out of reach here, so the
 * network leg (fetch auth) is covered by docs + the S-06 publish workflow, not
 * this test. The package has zero runtime deps, so the tarball install resolves
 * fully offline.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const INSTALLED_PKG = join("node_modules", "@10xpackages", "ai-toolkit");
const MAPPING_LINE = "@10xpackages:registry=https://npm.pkg.github.com";
const AUTH_LINE = "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}";
const TEST_TIMEOUT = 180_000;

// The installer trims the payload before fencing it (src/install.ts).
const EXPECTED_BLOCK = buildRulesBlock(
  readFileSync(join(REPO_ROOT, "rules", "CLAUDE.md"), "utf8").trim(),
);

let packDir: string;
let tarball: string;
const consumerRoots: string[] = [];

function npmEnv(token: string | null): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_AUTH_TOKEN;
  if (token !== null) env.NODE_AUTH_TOKEN = token;
  return env;
}

/** Build a fixture consumer project and `npm install` the packed tarball into it. */
function installConsumer(token: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "ai-toolkit-roundtrip-"));
  consumerRoots.push(root);

  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "consumer-fixture", version: "0.0.0", private: true }, null, 2) +
      "\n",
  );
  // The whole opt-in: one committed registry-mapping line, no token.
  writeFileSync(join(root, ".npmrc"), MAPPING_LINE + "\n");

  execSync(`npm install --prefer-offline --no-audit --no-fund "${tarball}"`, {
    cwd: root,
    env: npmEnv(token),
    stdio: "pipe",
  });
  return root;
}

const read = (root: string, ...parts: string[]): string =>
  readFileSync(join(root, ...parts), "utf8");

beforeAll(() => {
  if (!existsSync(join(REPO_ROOT, "dist", "cli.js"))) {
    execSync("npm run build", { cwd: REPO_ROOT, stdio: "inherit" });
  }
  packDir = mkdtempSync(join(tmpdir(), "ai-toolkit-pack-"));
  const out = execSync(`npm pack --pack-destination "${packDir}" --json`, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const parsed = JSON.parse(out) as Array<{ filename: string }>;
  tarball = join(packDir, parsed[0].filename);
  expect(existsSync(tarball)).toBe(true);
}, TEST_TIMEOUT);

afterAll(() => {
  if (packDir) rmSync(packDir, { recursive: true, force: true });
});

afterEach(() => {
  while (consumerRoots.length) {
    rmSync(consumerRoots.pop()!, { recursive: true, force: true });
  }
});

describe("registry round trip — tarball install into a consumer project", () => {
  it(
    "lays out skills, the rules block and a manifest; .npmrc stays mapping-only without NODE_AUTH_TOKEN",
    () => {
      const root = installConsumer(null);

      const skillLink = join(root, ".claude", "skills", "code-review");
      expect(existsSync(join(skillLink, "SKILL.md"))).toBe(true);
      // Roaming mode: the link resolves into the installed package under
      // node_modules, so it follows the dependency on `npm update`.
      expect(realpathSync(skillLink)).toBe(
        realpathSync(join(root, INSTALLED_PKG, "skills", "code-review")),
      );

      expect(EXPECTED_BLOCK).not.toBeNull();
      expect(read(root, "CLAUDE.md")).toContain(EXPECTED_BLOCK!);

      const manifest = JSON.parse(
        read(root, ".claude", ".ai-toolkit-manifest.json"),
      ) as { package: string; version: string; tool: string; files: string[] };
      expect(manifest.package).toBe(PACKAGE_NAME);
      expect(manifest.version).toBe(PACKAGE_VERSION);
      expect(manifest.tool).toBe("claude-code");
      expect(manifest.files).toContain(".claude/skills/code-review");
      expect(manifest.files).toContain("CLAUDE.md");
      expect(manifest.files).toContain(".npmrc");

      const npmrc = read(root, ".npmrc");
      expect(
        npmrc.split(/\r?\n/).filter((line) => line.trim() === MAPPING_LINE).length,
      ).toBe(1);
      expect(npmrc).not.toMatch(/_authToken/);

      // Second reconcile on a clean tree writes nothing — byte-identical files,
      // manifest installedAt unchanged.
      const before = [
        read(root, "CLAUDE.md"),
        read(root, ".npmrc"),
        read(root, ".claude", ".ai-toolkit-manifest.json"),
      ];
      execSync("node bin/ai-toolkit.js install", {
        cwd: join(root, "node_modules", "@10xpackages", "ai-toolkit"),
        env: npmEnv(null),
        stdio: "pipe",
      });
      expect([
        read(root, "CLAUDE.md"),
        read(root, ".npmrc"),
        read(root, ".claude", ".ai-toolkit-manifest.json"),
      ]).toEqual(before);
    },
    TEST_TIMEOUT,
  );

  it(
    "writes the literal ${NODE_AUTH_TOKEN} reference — never the token value — when the env var is set",
    () => {
      const root = installConsumer("round-trip-secret");

      const npmrc = read(root, ".npmrc");
      expect(npmrc).toContain(AUTH_LINE);
      expect(npmrc).not.toContain("round-trip-secret");
    },
    TEST_TIMEOUT,
  );
});
