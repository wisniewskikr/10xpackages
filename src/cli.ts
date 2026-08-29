#!/usr/bin/env node
import { PACKAGE_NAME, PACKAGE_VERSION } from "./manifest";
import { runInstall } from "./install";
import { runUninstall } from "./uninstall";

const USAGE = `${PACKAGE_NAME} v${PACKAGE_VERSION}

Usage:
  ai-toolkit install          Reconcile team skills and rules into this project
  ai-toolkit install --copy   Copy artifacts in instead of symlinking — for a
                              project with no package.json (Python, Go, Rust).
                              A bare \`npx ${PACKAGE_NAME} install\` in such a
                              project selects copy mode automatically.
  ai-toolkit uninstall        Remove every file this package installed (reads the install manifest)
  ai-toolkit --help           Show this message
`;

export async function run(argv: string[]): Promise<void> {
  const command = argv[2];
  const flags = argv.slice(3);

  switch (command) {
    case "install":
      await runInstall({ copy: flags.includes("--copy") });
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
