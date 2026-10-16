import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type FluentBuild,
  type FluentProject,
  type FluentProjects,
  writeFluentKeys,
} from "@snagentic/core";
import { addedKeys } from "../../src/governance/domain/fluent-keys";

const KEYS = readFileSync(
  join(import.meta.dir, "../../../../tests/fixtures/fluent/s11-flows/src/fluent/generated/keys.ts"),
  "utf8",
);
const WITHOUT_FLOW_B = KEYS.replace(/\n\s+s11_flow_b: \{[^}]*\}/, "");

describe("the IDs a build adds to keys.ts (P5)", () => {
  it("names the new IDs, from the SDK's own layout", () => {
    expect(addedKeys(WITHOUT_FLOW_B, KEYS)).toEqual(["s11_flow_b"]);
    expect(addedKeys(KEYS, KEYS)).toEqual([]);
    expect(addedKeys(null, KEYS)).toContain("s11_flow");
    expect(addedKeys(null, "explicit: {\n  'a-b': {\n    table: 'x'\n  }\n}")).toEqual(["a-b"]);
  });
});

const project = (path: string): FluentProject => ({ path, declaredSdk: "4.13.6" });

function fake(builds: Record<string, FluentBuild>) {
  const written: [string, string][] = [];
  const asked: string[] = [];
  const fluent: FluentProjects = {
    changedSince: async (commit) => {
      asked.push(commit);
      return Object.keys(builds).map(project);
    },
    holding: async (paths) =>
      Object.keys(builds)
        .filter((p) => paths.some((x) => x.startsWith(`${p}/`)))
        .map(project),
    build: async (p) =>
      builds[p.path] ?? { built: true, keys: null, deletes: [], units: [], scripts: new Map() },
    buildAt: async () => null,
    sdkVersion: async () => "4.13.6",
    writeKeys: async (p, keys) => {
      written.push([p.path, keys]);
    },
  };
  return { fluent, written, asked };
}

describe("writing a Fluent project's generated keys (P5, spec 005)", () => {
  it("writes the keys of each changed project whose build adds IDs, and names them", async () => {
    const { fluent, written, asked } = fake({
      "source/global": {
        built: true,
        keys: { committed: WITHOUT_FLOW_B, built: KEYS },
        deletes: [],
        units: [],
        scripts: new Map(),
      },
      "source/x_same": { built: true, keys: null, deletes: [], units: [], scripts: new Map() },
      "source/x_broken": { built: false, errors: [] },
    });
    expect(await writeFluentKeys(fluent, undefined)).toEqual({
      projects: 3,
      written: [{ path: "source/global", added: ["s11_flow_b"] }],
      notBuilt: ["source/x_broken"],
    });
    expect(asked).toEqual(["HEAD"]);
    expect(written).toEqual([["source/global", KEYS]]);
  });

  it("narrows to the projects holding the given paths", async () => {
    const { fluent, written } = fake({
      "source/a": {
        built: true,
        keys: { committed: null, built: KEYS },
        deletes: [],
        units: [],
        scripts: new Map(),
      },
      "source/b": {
        built: true,
        keys: { committed: null, built: KEYS },
        deletes: [],
        units: [],
        scripts: new Map(),
      },
    });
    const result = await writeFluentKeys(fluent, ["source/b/src/fluent/x.now.ts"]);
    expect(result.projects).toBe(1);
    expect(written.map(([path]) => path)).toEqual(["source/b"]);
  });
});
