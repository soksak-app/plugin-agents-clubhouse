// soksak-plugin-agents-clubhouse 번들 — esbuild 단일 ESM ui/clubhouse.js (view page ui/clubhouse.html). plain DOM.
import { build, context } from "esbuild";
const opts = {
  entryPoints: ["src/main.ts"], bundle: true, format: "esm", platform: "browser",
  target: "es2022", define: { "process.env.NODE_ENV": '"production"' },
  external: ["@soksak/plugin-api", "@soksak/plugin-api/*"], // resolved by the view import map of the host (core docs/spec/plugins.md#view-surfaces)
  outfile: "ui/clubhouse.js", minify: false, legalComments: "none", logLevel: "info",
};
if (process.argv.includes("--watch")) { const c = await context(opts); await c.watch(); console.log("[agents-clubhouse] watching …"); }
else { await build(opts); console.log("[agents-clubhouse] built ui/clubhouse.js"); }
