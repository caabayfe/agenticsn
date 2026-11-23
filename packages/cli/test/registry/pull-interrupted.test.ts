import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProfile, InstanceName, type Row } from "@snagentic/core";
import { fakeInstance } from "../../../core/test/support/fake-instance";
import { GitMirror } from "../../src/adapters/git/git-mirror";
import { gitSharedMirror } from "../../src/adapters/git/git-shared-mirror";
import { runGit, runGitOrThrow } from "../../src/adapters/git/run-git";
import { YamlProfileStore } from "../../src/adapters/profiles/yaml-profile-store";
import { syncStateStore } from "../../src/adapters/state/mirror-sync-state-store";
import { FsWorkspaceStore } from "../../src/adapters/workspace/fs-workspace-store";
import { executeUseCase } from "../../src/registry/execute";
import { pull } from "../../src/registry/pull";
import { PullOutput } from "../../src/registry/pull-output";
import { renderPull } from "../../src/registry/pull-render";
import type { UseCaseContext } from "../../src/registry/use-case";
import { FAKE_CONTEXT, TRUSTED_PASSWORD } from "../support/fakes";
import { TEAM_TIMEOUT } from "../support/team-workspace";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const PDI = InstanceName.parse("pdi");
const RULE =
  "instances/pdi/metadata/global/sys_script/rule--00000000000000000000000000000001.script.js";
const DATA: Record<string, Row[]> = {
  sys_db_object: [
    { sys_id: "c0", name: "sys_metadata", super_class: "" },
    { sys_id: "c1", name: "sys_script", super_class: "c0" },
  ],
  sys_scope: [{ sys_id: "global", scope: "global" }],
  sys_dictionary: [
    { sys_id: "d1", name: "sys_script", element: "script", internal_type: "script_server" },
  ],
  sys_script: [
    {
      sys_id: "00000000000000000000000000000001",
      sys_class_name: "sys_script",
      name: "Rule",
      script: "run();",
      sys_scope: "global",
    },
  ],
};

// A workspace with a real git mirror and a real checkpoint, on a fake instance.
async function setup() {
  const base = await mkdtemp(join(tmpdir(), "snagentic-pull-"));
  temporary.push(base);
  const root = join(base, "w");
  await new FsWorkspaceStore().create(root, { layout: 2, createdWith: "test" });
  const profiles = new YamlProfileStore();
  await profiles.write(
    root,
    createProfile({
      name: PDI,
      url: "dev1",
      username: "admin",
      kind: "development",
      acknowledgeReadOnly: false,
    }),
  );
  const instance = fakeInstance(structuredClone(DATA));
  const context: UseCaseContext = {
    ...FAKE_CONTEXT,
    workspaces: new FsWorkspaceStore(),
    profiles,
    credentials: TRUSTED_PASSWORD,
    connections: { open: () => instance.reader, openForWrite: () => instance.reader },
    syncState: syncStateStore,
    sharedMirror: gitSharedMirror,
    mirrors: { open: (r, name, mode) => GitMirror.open(r, name, mode) },
    host: { cwd: root, home: base, version: "test" },
  };
  const run = () => executeUseCase(pull, { instance: "pdi" }, context);
  const mirrored = async () =>
    (await runGit(["show", `servicenow-remote/pdi:${RULE}`], root)).stdout;
  return { root, run, mirrored, instance, state: syncStateStore(root, PDI) };
}

// Each test runs several pulls: git on the Windows runner is slow (see pull.test.ts).
describe("a pull that stopped after its mirror commit", () => {
  it(
    "keeps the mirror when a full pull stops during compaction",
    async () => {
      const { root, run, mirrored, state } = await setup();
      // Only git repack reads this setting: it fails, as it would on a full disk.
      await runGitOrThrow(["config", "repack.writeBitmaps", "not-a-boolean"], root);
      const first = await run();
      expect(first.output).toMatchObject({ mode: "full", changed: true, records: 1 });
      expect(first.output["warnings"]).toEqual([expect.stringContaining("git repack")]);
      expect(renderPull(PullOutput.parse(first.output))).toContain(
        "  warning: the mirror is committed",
      );
      expect(await state.readCheckpoint()).toBeNull();
      const second = await run();
      expect(second.output).toMatchObject({ mode: "incremental", resumed: false, warnings: [] });
      expect(await mirrored()).toBe("run();\n");
    },
    TEAM_TIMEOUT,
  );

  it(
    "reports failed housekeeping after an incremental pull as a warning",
    async () => {
      const { root, run, mirrored, instance, state } = await setup();
      await run();
      // Only git gc reads this setting.
      await runGitOrThrow(["config", "gc.auto", "not-a-number"], root);
      const rule = instance.tables["sys_script"]?.[0];
      Object.assign(rule ?? {}, { script: "changed();", sys_updated_on: "2026-10-05 12:30:00" });
      const { output } = await run();
      expect(output).toMatchObject({ mode: "incremental", changed: true, records: 1 });
      expect(output["warnings"]).toEqual([expect.stringContaining("git gc")]);
      expect(await mirrored()).toBe("changed();\n");
      expect(output["watermark"]).toBe((await state.readState())?.watermark);
    },
    TEAM_TIMEOUT,
  );

  it(
    "continues from the finished mirror when the checkpoint outlived the pull",
    async () => {
      const { run, mirrored, state } = await setup();
      await run();
      const pulled = await state.readState();
      // What a pull killed between moving the branch and clearing its checkpoint leaves.
      await state.writeCheckpoint({
        startedAt: pulled?.lastFullPull ?? "",
        completedClasses: ["sys_script"],
        records: 1,
      });
      const { output } = await run();
      expect(output).toMatchObject({ mode: "incremental", resumed: false });
      expect(await state.readCheckpoint()).toBeNull();
      expect(await mirrored()).toBe("run();\n");
    },
    TEAM_TIMEOUT,
  );

  it(
    "reads every class again when an interrupted pull's progress is gone",
    async () => {
      const { run, mirrored, state } = await setup();
      await run();
      // A later full pull whose checkpoint claims a class no progress commit holds.
      await state.writeCheckpoint({
        startedAt: "2026-10-05 12:30:00",
        completedClasses: ["sys_script"],
        records: 1,
      });
      const { output } = await run();
      expect(output).toMatchObject({ mode: "full", records: 1 });
      expect(await mirrored()).toBe("run();\n");
    },
    TEAM_TIMEOUT,
  );
});
