#!/usr/bin/env node
"use strict";

// Stable, build-layout-independent entrypoint for `package.json#bin` and the
// `postinstall` hook. Delegates to the compiled CLI. Fails soft when `dist/`
// is absent (e.g. postinstall before a build) so it never breaks `npm install`.
try {
  require("../dist/cli.js");
} catch (error) {
  const message = error && error.message ? error.message : String(error);
  console.warn(`@wisniewskikr/ai-toolkit: CLI not built yet (${message})`);
}
