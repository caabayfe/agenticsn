import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadFluentRuntime,
  loadInProcessRuntime,
} from "../../../src/adapters/fluent/fluent-runtime-loader";

// The first build and the drafted transform go through the worker snagentic uses (ADR-0044); the
// rest load the SDK in-process, which is faster from source.
import { SdkToolchain } from "../../../src/adapters/fluent/fluent-toolchain";
import { SDK_BUILD_TIMEOUT } from "../../support/sdk-contract";

// The embedded SDK on copies of a workspace's project (ADR-0031): builds and transform drafts
// never write the workspace.

const SCOPE = { name: "x_2222332_s11", sysId: "489da54ae67c4a3e9f1e1e4347e9119b" };
const project = { path: `source/${SCOPE.name}`, scope: SCOPE.name, scopeId: SCOPE.sysId };
const FIXTURES = join(import.meta.dir, "../../../../../tests/fixtures/sdk/transform");
const RECORDING = join(FIXTURES, "script-include-pdi2.json");

// The recorded global records convert into a global project.
const GLOBAL = { path: "source/global", scope: "global", scopeId: "global" };

function workspace(source?: string, into = project) {
  const root = mkdtempSync(join(tmpdir(), "snagentic-toolchain-"));
  const dir = join(root, into.path);
  mkdirSync(join(dir, "src/fluent"), { recursive: true });
  const config = {
    scope: into.scope,
    scopeId: into.scopeId,
    name: into.scope,
    type: "configuration",
  };
  writeFileSync(join(dir, "now.config.json"), JSON.stringify(config));
  const manifest = {
    name: "s11",
    version: "0.0.1",
    devDependencies: { "@servicenow/sdk": "4.13.6" },
  };
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
  if (source !== undefined) writeFileSync(join(dir, "src/fluent/p.now.ts"), source);
  return { root, dir };
}

const PROPERTY = `import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['p'],
    table: 'sys_properties',
    data: { name: 'x_2222332_s11.flag', value: 'true', type: 'boolean' },
})
`;

describe("SdkToolchain", () => {
  it(
    "builds a project in a copy, as units and the XML a load sends",
    async () => {
      const { root, dir } = workspace(PROPERTY);
      const outcome = await new SdkToolchain(root, loadFluentRuntime).build(project);
      expect(outcome.ok).toBe(true);
      const units = outcome.ok ? outcome.units : [];
      expect(units.map((u) => u.head.table)).toEqual(["sys_properties"]);
      expect(outcome.ok && outcome.files.get(units[0]?.file ?? "")).toContain("x_2222332_s11.flag");
      expect(existsSync(join(dir, "dist"))).toBe(false);
    },
    SDK_BUILD_TIMEOUT,
  );

  it(
    "says why a project does not build",
    async () => {
      const { root } = workspace("Record({ table: \n");
      const outcome = await new SdkToolchain(root, loadInProcessRuntime).build(project);
      expect(outcome).toMatchObject({
        ok: false,
        message: expect.stringContaining("src/fluent/p.now.ts"),
      });
    },
    SDK_BUILD_TIMEOUT,
  );

  it(
    "names every error of a project that does not build, not only the first",
    async () => {
      const { root } = workspace("const a = (x: string) => x\nconst b = (y: number) => y\n");
      const outcome = await new SdkToolchain(root, loadInProcessRuntime).build(project);
      if (outcome.ok) throw new Error("built");
      expect(outcome.message).toContain("src/fluent/p.now.ts:1 ");
      expect(outcome.message).toContain("src/fluent/p.now.ts:2 ");
    },
    SDK_BUILD_TIMEOUT,
  );

  it(
    "drafts a transform in a copy: the units before and after, and the files it wrote",
    async () => {
      const { root, dir } = workspace();
      const recording = JSON.parse(readFileSync(RECORDING, "utf8"));
      const access = {
        host: "https://instance.example.com/",
        exchange: async () => recording.exchanges[0].answer,
      };
      const outcome = await new SdkToolchain(root, loadFluentRuntime).draftTransform(
        project,
        recording.records,
        access,
      );
      if (!outcome.ok) throw new Error(outcome.message);
      expect(outcome.draft.before).toEqual([]);
      expect(outcome.draft.after.map((u) => u.updateName)).toEqual([
        "sys_script_include_123833b4d97d48be8e9ec5ea16f27764",
      ]);
      expect([...outcome.draft.files.keys()].some((f) => f.endsWith(".server.js"))).toBe(true);
      expect(existsSync(join(dir, "src/fluent/generated"))).toBe(false);
      const refused = await new SdkToolchain(root, loadFluentRuntime).draftTransform(
        project,
        recording.records,
        {
          ...access,
          exchange: async () => ({
            status: 400,
            contentType: "application/json",
            text: '{"error":{"message":"Record not found"}}',
          }),
        },
      );
      expect(refused.ok).toBe(false);
    },
    SDK_BUILD_TIMEOUT,
  );

  // Spec 009 X4: recorded from pdi2, where 4,776 of 5,350 policy actions have an empty type.
  it(
    "builds a converted UI policy whose actions have an empty message type",
    async () => {
      const { root } = workspace(undefined, GLOBAL);
      const recording = JSON.parse(
        readFileSync(join(FIXTURES, "ui-policy-empty-message-type-pdi2.json"), "utf8"),
      );
      const access = {
        host: "https://instance.example.com/",
        exchange: async () => recording.exchanges[0].answer,
      };
      const outcome = await new SdkToolchain(root, loadInProcessRuntime).draftTransform(
        GLOBAL,
        recording.records,
        access,
      );
      if (!outcome.ok) throw new Error(outcome.message);
      expect(outcome.draft.after.some((u) => u.head.table === "sys_ui_policy_action")).toBe(true);
    },
    SDK_BUILD_TIMEOUT,
  );

  it(
    "refuses a converted script include whose access is empty, before building",
    async () => {
      const { root } = workspace(undefined, GLOBAL);
      const recording = JSON.parse(
        readFileSync(join(FIXTURES, "script-include-empty-access-pdi2.json"), "utf8"),
      );
      const access = {
        host: "https://instance.example.com/",
        exchange: async () => recording.exchanges[0].answer,
      };
      const outcome = await new SdkToolchain(root, loadInProcessRuntime).draftTransform(
        GLOBAL,
        recording.records,
        access,
      );
      expect(outcome).toEqual({
        ok: false,
        message: expect.stringContaining("Accessible from"),
        refused: [expect.stringContaining("Accessible from")],
      });
    },
    SDK_BUILD_TIMEOUT,
  );
});
