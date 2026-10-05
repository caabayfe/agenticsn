import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProfile,
  InstanceName,
  type InstanceReader,
  instancePaths,
  type Row,
} from "@snagentic/core";
import { gitIntegrator } from "../../src/adapters/git/git-integrator";
import { GitMirror } from "../../src/adapters/git/git-mirror";
import { runGitOrThrow } from "../../src/adapters/git/run-git";
import { YamlProfileStore } from "../../src/adapters/profiles/yaml-profile-store";
import { JsonSyncStateStore } from "../../src/adapters/state/json-sync-state-store";
import { FsWorkspaceStore } from "../../src/adapters/workspace/fs-workspace-store";
import { executeUseCase } from "../../src/registry/execute";
import { integrate } from "../../src/registry/integrate";
import { pull } from "../../src/registry/pull";
import type { UseCaseContext } from "../../src/registry/use-case";
import { FAKE_CONTEXT } from "../support/fakes";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

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

function fakeInstance(): InstanceReader {
  return {
    query: async (query) => {
      const after = /sys_id>([^^]+)/.exec(query.query)?.[1] ?? "";
      const cls = /sys_class_name=([^^]+)/.exec(query.query)?.[1];
      return (DATA[query.table] ?? []).filter(
        (row) =>
          (cls === undefined || row["sys_class_name"] === cls) && (row["sys_id"] ?? "") > after,
      );
    },
    stats: () => ({
      requests: 7,
      retries: 0,
      semaphoreWaitMs: 3,
      transactionIds: [],
      concurrencyLimit: 2,
      peakConcurrency: 2,
      requestMs: 0,
    }),
  };
}

async function setup(): Promise<{ root: string; context: UseCaseContext }> {
  const base = await mkdtemp(join(tmpdir(), "snagentic-pull-"));
  temporary.push(base);
  const root = join(base, "w");
  await new FsWorkspaceStore().create(root, { layout: 1, createdWith: "test" });
  const profiles = new YamlProfileStore();
  await profiles.write(
    root,
    createProfile({
      name: InstanceName.parse("pdi"),
      url: "dev1",
      username: "admin",
      kind: "development",
      acknowledgeReadOnly: false,
    }),
  );
  const context: UseCaseContext = {
    ...FAKE_CONTEXT,
    workspaces: new FsWorkspaceStore(),
    profiles,
    credentials: { read: async () => "pw", write: async () => {}, remove: async () => false },
    connections: { open: () => fakeInstance() },
    syncState: (r, instance) => new JsonSyncStateStore(join(r, instancePaths(instance).localState)),
    mirrors: { open: (r, instance, resume) => GitMirror.open(r, instance, resume) },
    integrator: gitIntegrator,
    host: { cwd: root, home: base, version: "test" },
  };
  return { root, context };
}

describe("pull and integrate", () => {
  it("pulls an instance into its remote branch, reports the load, and integrates it", async () => {
    const { root, context } = await setup();
    const { output } = await executeUseCase(pull, { instance: "pdi" }, context);
    expect(output).toMatchObject({
      instance: "pdi",
      mode: "full",
      resumed: false,
      records: 1,
      requests: 7,
      semaphoreWaitMs: 3,
      watermark: "2026-10-05 12:00:00",
    });
    expect(
      await runGitOrThrow(["ls-tree", "-r", "--name-only", "servicenow-remote/pdi"], root),
    ).toContain("rule--00000000000000000000000000000001.script.js");
    const integrated = await executeUseCase(integrate, { instance: "pdi" }, context);
    // The record and its script, plus the four (here empty) operational inventory files.
    expect(integrated.output["changedFiles"]).toBe(6);
  });

  it("asks for --full on a second pull until incremental pulls exist", async () => {
    const { context } = await setup();
    await executeUseCase(pull, { instance: "pdi" }, context);
    await expect(executeUseCase(pull, { instance: "pdi" }, context)).rejects.toMatchObject({
      code: "incremental-not-available",
    });
    const again = await executeUseCase(pull, { instance: "pdi", full: true }, context);
    expect(again.output["records"]).toBe(1);
  });

  it("renders the summary with the instance load and the next step", () => {
    const text = pull.render(
      {
        instance: "pdi",
        mode: "full",
        resumed: true,
        commit: "abcdef1234567",
        classes: 3,
        records: 10,
        childRows: 2,
        operationalRows: 4,
        skippedRows: 0,
        unreadable: ["sys_x"],
        watermark: "w",
        requests: 9,
        retries: 1,
        semaphoreWaitMs: 5,
        seconds: 1.5,
        phaseSeconds: { catalog: 0.1, records: 1, children: 0.2, operational: 0.1, commit: 0.1 },
        peakConcurrency: 3,
        requestSeconds: 2.4,
        peakMemoryMb: 120,
      },
      "text",
    );
    expect(text).toContain("pulled pdi (resumed) in 1.5 s -> abcdef1234 on servicenow-remote/pdi");
    expect(text).toContain(
      "instance load: 9 requests, 1 retries, semaphore wait 5 ms, peak concurrency 3",
    );
    expect(text).toContain(
      "time: catalog 0.1 s, records 1 s, child rows 0.2 s, inventory 0.1 s, commit 0.1 s; 2.4 s in requests; peak memory 120 MB",
    );
    expect(text).toContain("not readable by this user: sys_x");
    expect(integrate.render({ instance: "pdi", commit: null, changedFiles: 0 }, "text")).toBe(
      "pdi: already up to date",
    );
  });
});
