import * as path from "node:path";

import { PACKAGE_NAME } from "./manifest";

/**
 * Walk up from this module's directory looking for an enclosing `node_modules/`.
 * When found, the parent of `node_modules/` is the consumer project root and the
 * package is running as an installed dependency. When not found, we are running
 * from a checkout of the toolkit repo itself (local dev, CI) and install is a
 * no-op.
 */
function findConsumerRoot(): string | null {
  if (process.env.PROJECT_ROOT) return process.env.PROJECT_ROOT;

  let dir = __dirname;
  while (dir !== path.dirname(dir)) {
    if (path.basename(dir) === "node_modules") return path.dirname(dir);
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Installer entrypoint — STUB.
 *
 * The real reconcile logic (lay out skills, inject the sentinel-fenced rules
 * block, ensure the registry-mapping line, write the manifest) lands in change
 * `consumer-install-symlink` (S-01). Until then this only reports what it would
 * target. It never throws: an exception here must not fail a consumer's
 * `npm install`.
 */
export async function runInstall(): Promise<void> {
  try {
    const consumerRoot = findConsumerRoot();
    if (consumerRoot === null) {
      console.log(
        `${PACKAGE_NAME}: install skeleton — running from a toolkit checkout, nothing to do.`,
      );
      return;
    }
    console.log(
      `${PACKAGE_NAME}: install skeleton — reconcile logic not yet implemented ` +
        `(see change consumer-install-symlink). Target project root: ${consumerRoot}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`${PACKAGE_NAME}: install skeleton warning: ${message}`);
  }
}
