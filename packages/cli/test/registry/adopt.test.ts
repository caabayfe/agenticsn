import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type FluentToolchain,
  InvalidRecordReferenceError,
  SdkUnavailableError,
} from "@snagentic/core";
import { builtUnitOf } from "../../src/adapters/fluent/built-units";
import { WorkspaceAuthoring } from "../../src/adapters/fluent/workspace-authoring";
import { adopt } from "../../src/registry/adopt";
import { executeUseCase } from "../../src/registry/execute";
import { instanceWorkspace } from "../support/instance-workspace";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const FIXTURE = join(import.meta.dir, "../../../../tests/fixtures/fluent/units");
const SI_FILE = "sys_script_include_123833b4d97d48be8e9ec5ea16f27764.xml";
const SI_ID = "123833b4d97d48be8e9ec5ea16f27764";
const SCOPE_ID = "489da54ae67c4a3e9f1e1e4347e9119b";
const xml = readFileSync(join(FIXTURE, SI_FILE), "utf8");

const runtime = async () => ({
  sdkVersion: "4.13.6",
  build: async () => ({ success: true as const, records: [] }),
  transform: async () => ({ success: false as const, message: "unused" }),
});

async function workspace(sdk = true) {
  const unit = builtUnitOf(SI_FILE, xml);
  const ws = await instanceWorkspace({
    sys_script_include: [
      {
        ...unit.head.fields,
        sys_class_name: "sys_script_include",
        sys_scope: SCOPE_ID,
        sys_mod_count: "1",
        sys_updated_on: "2026-10-16 06:30:48",
      },
    ],
    sys_scope: [{ sys_id: SCOPE_ID, scope: "x_2222332_s11", sys_class_name: "sys_app" }],
  });
  cleanups.push(ws.cleanup);
  const toolchain: FluentToolchain = {
    build: async () => ({ ok: false, message: "unused" }),
    draftTransform: async () => ({
      ok: true,
      draft: {
        before: [],
        after: [unit],
        files: new Map([["src/fluent/si.now.ts", "ScriptInclude({})\n"]]),
      },
    }),
  };
  const sdkAccess = () => ({
    host: "https://instance.example.com/",
    exchange: async () => ({ status: 500, contentType: "", text: "" }),
  });
  const reader = sdk ? { ...ws.instance.reader, sdkAccess } : ws.instance.reader;
  const context = {
    ...ws.context,
    connections: { open: () => reader },
    authoring: () => ({ workspace: new WorkspaceAuthoring(ws.root, runtime), toolchain }),
  };
  return { ...ws, context };
}

describe("adopt", () => {
  it("writes the scope's project, its source and its ledger", async () => {
    const { context, root } = await workspace();
    const { output, exitCode } = await executeUseCase(
      adopt,
      { instance: "pdi", records: [`sys_script_include:${SI_ID}`] },
      context,
    );
    expect(exitCode).toBe(0);
    expect(output).toMatchObject({
      instance: "pdi",
      projects: [{ path: "source/x_2222332_s11", created: true }],
      units: [{ updateName: `sys_script_include_${SI_ID}`, losses: [] }],
      files: ["source/x_2222332_s11/src/fluent/si.now.ts"],
      unmanaged: [],
      conflicts: [],
    });
    expect(
      readFileSync(join(root, "source/x_2222332_s11/snagentic.ledger.yaml"), "utf8"),
    ).toContain(`sys_script_include_${SI_ID}:`);
    const text = adopt.render(output as never, "text");
    expect(text).toContain("created source/x_2222332_s11");
    expect(text).toContain("review and commit them with the ledger");
  });

  it("renders what a load also sets, what stays unmanaged, and conflicts", () => {
    const text = adopt.render(
      {
        instance: "pdi",
        projects: [],
        units: [{ project: "p", updateName: "u", table: "t", losses: ["api-default"] }],
        files: [],
        unmanaged: ["ua_table_licensing_config:1"],
        conflicts: ["p/a.now.ts"],
      },
      "text",
    );
    expect(text.split("\n")).toEqual([
      "adopted u  (also sets: api-default)",
      "  api-default: the SDK writes its API's default instead of the instance's value",
      "not adopted: ua_table_licensing_config:1 (the SDK cannot express it; it stays as it is)",
      "conflict: p/a.now.ts (local and instance edits overlap; resolve it)",
      "0 source file(s) written; review and commit them with the ledger",
    ]);
  });

  it("refuses a reference with no sys_id, and a connection without the SDK", async () => {
    const { context } = await workspace();
    await expect(
      executeUseCase(adopt, { instance: "pdi", records: ["E2EUtil"] }, context),
    ).rejects.toBeInstanceOf(InvalidRecordReferenceError);
    const bare = await workspace(false);
    await expect(
      executeUseCase(adopt, { instance: "pdi", records: [SI_ID] }, bare.context),
    ).rejects.toBeInstanceOf(SdkUnavailableError);
  });
});
