// The release contract of the room: the view page and its bundle are the only runtime files, the ACP dependency is gone, and
// plugin.json declares the statuses, commands, elements and project data that the page registers.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const pkg = JSON.parse(read("package.json")) as { engines?: Record<string, string>; files: string[]; dependencies?: Record<string, string>; devDependencies: Record<string, string> };
const manifest = JSON.parse(read("plugin.json")) as {
  dependencies?: Record<string, string>;
  surface: { composition: { kind: string; page: string } };
  exposes: { commands: { name: string }[]; element: { name: string }[]; status: { name: string }[] };
};

describe("core range", () => {
  // The room declares the core range that C120 set.
  it("declares engines.soksak ^0.0.52", () => {
    expect(pkg.engines).toEqual({ soksak: "^0.0.52" });
  });
});

describe("first start program", () => {
  // pnpm pack keeps the execute bit only of a file that bin names, and core installs a plugin: program only with that bit (C104).
  it("declares bin/first-start.mjs as the program of member-start and project-trust, ships it and names it in bin", () => {
    const programs = (manifest as unknown as { programs: Record<string, { program: string }> }).programs;
    expect(programs["member-start"]!.program).toBe("plugin:bin/first-start.mjs");
    expect(programs["project-trust"]!.program).toBe("plugin:bin/first-start.mjs");
    expect(programs["team-worktree"]).toBeUndefined();
    // C148 (docs/spec/room.md#worktrees): the worktree commands of the same program.
    expect(programs["member-worktree-remove"]).toBeUndefined();
    for (const name of ["member-worktree", "member-root", "member-memory", "member-check"]) expect(programs[name]!.program).toBe("plugin:bin/first-start.mjs");
    expect(pkg.files).toContain("bin/first-start.mjs");
    expect(Object.values((pkg as unknown as { bin: Record<string, string> }).bin)).toEqual(["bin/first-start.mjs"]);
  });
});

// The hosts compile each argument pattern of a program with RE2 (Go regexp), whose repeat count is at most 1000; a larger count makes the
// host refuse the whole plugin, although the JavaScript validator accepts it (C152).
describe("program argument patterns", () => {
  it("use no repeat count above 1000", () => {
    const programs = (manifest as unknown as { programs: Record<string, { args: unknown[] }> }).programs;
    const counts = Object.values(programs)
      .flatMap((one) => one.args)
      .flatMap((arg) => (typeof arg === "object" && arg !== null && "pattern" in arg ? [String((arg as { pattern: string }).pattern)] : []))
      .flatMap((pattern) => [...pattern.matchAll(/\{(\d+)(?:,(\d*))?\}/g)].flatMap((match) => [Number(match[1]), Number(match[2] || 0)]));
    expect(counts.filter((count) => count > 1000)).toEqual([]);
  });
});

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
  // The only dependency is the package of the agents plugin, whose data the room reads (core F1074); no ACP plugin is named. The room
  // reads the leader of a group, which the stored groups hold from agents 0.0.10 (A54, C157).
  it("declares the agents plugin with group leaders as its only dependency and no ACP package", () => {
    expect(manifest.dependencies ?? {}).toEqual({ "@soksak/plugin-agents": ">=0.0.10" });
    expect(Object.keys(pkg.devDependencies)).not.toContain("@agentclientprotocol/sdk");
  });

  it("has no ACP transport source", () => {
    expect(existsSync(join(root, "src/engine.ts"))).toBe(false);
    expect(existsSync(join(root, "src/room/acp-shapes.ts"))).toBe(false);
  });

  it("exposes no ask, converse or send command, and declares the arrangement, check, conversation, view and transport statuses", () => {
    const names = manifest.exposes.commands.map((c) => c.name);
    for (const removed of ["ask", "converse", "send"]) {
      expect(names).not.toContain(`soksak-plugin-agents-clubhouse.${removed}`);
    }
    expect(manifest.exposes.status.map((s) => s.name)).toEqual([
      "soksak-plugin-agents-clubhouse.arrangement",
      "soksak-plugin-agents-clubhouse.check",
      "soksak-plugin-agents-clubhouse.conversation",
      "soksak-plugin-agents-clubhouse.view",
      "soksak-plugin-agents-clubhouse.transport",
    ]);
  });
});

describe("the conversation bound (docs/spec/room.md#conversation)", () => {
  it("declares the setting conversationTurns, the stop command and the stop button", () => {
    const full = JSON.parse(read("plugin.json"));
    expect(full.settings.conversationTurns).toMatchObject({ type: "integer", default: 48, minimum: 0, maximum: 64 });
    expect(manifest.exposes.commands.map((c) => c.name)).toContain("soksak-plugin-agents-clubhouse.conversation.stop");
    expect(manifest.exposes.element.map((e) => e.name)).toContain("soksak-plugin-agents-clubhouse.stop");
  });
});
