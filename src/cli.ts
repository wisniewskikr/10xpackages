#!/usr/bin/env node
import { PACKAGE_NAME, PACKAGE_VERSION } from "./manifest";
import { runInstall } from "./install";
import { runUninstall } from "./uninstall";

const USAGE = `${PACKAGE_NAME} v${PACKAGE_VERSION}

Usage:
  ai-toolkit install     Lay out team skills and rules into this project (stub)
  ai-toolkit uninstall   Remove files this package installed (stub)
  ai-toolkit --help      Show this message

Note: install/uninstall are skeleton stubs until change consumer-install-symlink lands.
`;

export async function run(argv: string[]): Promise<void> {
  const command = argv[2];

  switch (command) {
    case "install":
      await runInstall();
      return;
    case "uninstall":
      await runUninstall();
      return;
    case "--help":
    case "-h":
    case undefined:
      process.stdout.write(USAGE);
      return;
    default:
      process.stdout.write(`Unknown command: ${command}\n\n${USAGE}`);
      return;
  }
}

run(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`${PACKAGE_NAME}: ${message}`);
});
