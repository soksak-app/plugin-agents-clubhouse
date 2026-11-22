// The release contract of the room: the view page and its bundle are the only runtime files, the ACP dependency is gone, and
// plugin.json declares the statuses, commands, elements and project data that the page registers.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const pkg = JSON.parse(read("package.json")) as { files: string[]; dependencies?: Record<string, string>; devDependencies: Record<string, string> };
const manifest = JSON.parse(read("plugin.json")) as {
  dependencies?: Record<string, string>;
  surface: { composition: { kind: string; page: string } };
  exposes: { commands: { name: string }[]; element: { name: string }[]; status: { name: string }[] };
};

describe("release files", () => {
  it("lists the view page and its bundle in the files of package.json", () => {
    expect(pkg.files).toEqual(expect.arrayContaining(["plugin.json", manifest.surface.composition.page, "ui/clubhouse.js"]));
  });

  it("serves the bundle from the page, which exists in the repository", () => {
    expect(manifest.surface.composition.page).toBe("ui/clubhouse.html");
    expect(read("ui/clubhouse.html")).toContain('src="./clubhouse.js"');
  });

  it("builds the bundle from src/main.ts into ui/clubhouse.js", () => {
    expect(read("build.mjs")).toContain('outfile: "ui/clubhouse.js"');
    expect(read("build.mjs")).toContain('entryPoints: ["src/main.ts"]');
  });
});

describe("ACP removal", () => {
  // The only dependency is the package of the agents plugin, whose data the room reads (core F1074); no ACP plugin is named.
  it("declares the package of the agents plugin as its only dependency and no ACP package", () => {
    expect(manifest.dependencies ?? {}).toEqual({ "@soksak/plugin-agents": "^0.0.1" });
    expect(Object.keys(pkg.devDependencies)).not.toContain("@agentclientprotocol/sdk");
  });

  it("has no ACP transport source", () => {
    expect(existsSync(join(root, "src/engine.ts"))).toBe(false);
    expect(existsSync(join(root, "src/room/acp-shapes.ts"))).toBe(false);
  });

  it("exposes no ask, converse or send command, and declares the transport status", () => {
    const names = manifest.exposes.commands.map((c) => c.name);
    for (const removed of ["ask", "converse", "send"]) {
      expect(names).not.toContain(`soksak-plugin-agents-clubhouse.${removed}`);
    }
    expect(manifest.exposes.status.map((s) => s.name)).toEqual([
      "soksak-plugin-agents-clubhouse.arrangement",
      "soksak-plugin-agents-clubhouse.transport",
    ]);
  });
});

describe("tower header action", () => {
  it("is the room element tower, not a titlebar action", () => {
    expect(manifest.exposes.element.map((e) => e.name)).toContain("soksak-plugin-agents-clubhouse.tower");
    expect(read("src/tower/header.ts")).not.toContain("registerHeaderAction");
  });
});
