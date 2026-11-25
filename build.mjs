// soksak-plugin-agents-clubhouse 번들 — esbuild 단일 ESM ui/clubhouse.js (view page ui/clubhouse.html). plain DOM.
import { build, context } from "esbuild";
const opts = {
  entryPoints: ["src/main.ts"], bundle: true, format: "esm", platform: "browser",
  target: "es2022", define: { "process.env.NODE_ENV": '"production"' },
  external: ["@soksak/plugin-api", "@soksak/plugin-api/*"], // resolved by the view import map of the host (core docs/spec/plugins.md#view-surfaces)
  outfile: "ui/clubhouse.js", minify: false, legalComments: "none", logLevel: "info",
};
// The invite dialog page of the room (docs/spec/room.md#invite) is its own bundle, ui/invite.js of ui/invite.html.
const invite = { ...opts, entryPoints: ["src/invite-page.ts"], outfile: "ui/invite.js" };
// The first start program runs in Node as the declared programs project-trust and member-start, with proper-lockfile bundled
// (docs/spec/room.md#first-start).
const tool = {
  entryPoints: ["src/bin/first-start.ts"], bundle: true, format: "esm", platform: "node", target: "node20",
  outfile: "bin/first-start.mjs", banner: { js: "#!/usr/bin/env node\nimport { createRequire } from \"node:module\"; const require = createRequire(import.meta.url);" },
  legalComments: "none", logLevel: "info",
};
if (process.argv.includes("--watch")) { const c = await context(opts); await c.watch(); console.log("[agents-clubhouse] watching …"); }
else {
  await build(opts);
  await build(invite);
  await build(tool);
  const { chmodSync } = await import("node:fs");
  chmodSync("bin/first-start.mjs", 0o755);
  console.log("[agents-clubhouse] built ui/clubhouse.js, ui/invite.js and bin/first-start.mjs");
}
