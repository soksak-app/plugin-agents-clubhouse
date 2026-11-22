// plugin.json passes the manifest validator of core (docs/spec/room.md#manifest), validateManifest of the plugin-api release of the
// core version that the plugin installs into, which `sok plugin install` replays; a schema keyword outside the subset of core
// exposures (type, properties, required, items, enum) is refused at install.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateManifest } from "@soksak/plugin-api";

const manifest = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "plugin.json"), "utf8"));

describe("plugin.json", () => {
  it("passes validateManifest of core", () => {
    expect(() => validateManifest(manifest)).not.toThrow();
  });
});
