import { PACKAGE_NAME } from "./manifest";

/**
 * Uninstaller entrypoint — STUB.
 *
 * The real logic (read the manifest, remove exactly the files it lists, strip
 * the sentinel-fenced rules block) lands in change `consumer-uninstall-clean`
 * (S-03). Same no-throw contract as {@link runInstall}.
 */
export async function runUninstall(): Promise<void> {
  try {
    console.log(
      `${PACKAGE_NAME}: uninstall skeleton — manifest-driven removal not yet ` +
        `implemented (see change consumer-uninstall-clean).`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`${PACKAGE_NAME}: uninstall skeleton warning: ${message}`);
  }
}
