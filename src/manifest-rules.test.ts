// The length rules of plugin.json that core checks when it installs a release (core docs/spec/plugins.md, plugin.json and settings):
// the plugin description has 1 to 200 characters, and each setting has a label of 1 to 40 characters and a description of 1 to 200
// characters. A character is a code point.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(join(process.cwd(), "plugin.json"), "utf8")) as {
  description: string;
  settings?: Record<string, { label: string; description?: string }>;
};
const length = (text: string) => [...text].length;

describe("plugin.json length rules", () => {
  it("has a description of 1 to 200 characters", () => {
    expect(length(manifest.description)).toBeGreaterThanOrEqual(1);
    expect(length(manifest.description)).toBeLessThanOrEqual(200);
  });

  it("has setting labels of 1 to 40 characters and setting descriptions of 1 to 200 characters", () => {
    for (const [key, setting] of Object.entries(manifest.settings ?? {})) {
      expect(length(setting.label), key).toBeGreaterThanOrEqual(1);
      expect(length(setting.label), key).toBeLessThanOrEqual(40);
      if (setting.description !== undefined) {
        expect(length(setting.description), key).toBeGreaterThanOrEqual(1);
        expect(length(setting.description), key).toBeLessThanOrEqual(200);
      }
    }
  });
});

// The registry publishes a release under the scoped package name @soksak/<name> with its license (C33).
const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { name: string; license?: string };

describe("package.json registry rules", () => {
  it("has the scoped name @soksak/plugin-agents-clubhouse", () => {
    expect(packageJson.name).toBe("@soksak/plugin-agents-clubhouse");
  });

  it("declares the MIT license", () => {
    expect(packageJson.license).toBe("MIT");
  });
});
