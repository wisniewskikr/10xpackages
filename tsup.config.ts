import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/install.ts", "src/uninstall.ts", "src/cli.ts"],
  format: ["cjs"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: false,
  dts: false,
});
