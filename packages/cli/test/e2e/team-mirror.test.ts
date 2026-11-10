import { afterEach, expect, describe as group, it, setDefaultTimeout } from "bun:test";
import { InstanceName, type Row } from "@snagentic/core";
import { runGitOrThrow } from "../../src/adapters/git/run-git";
import { describe } from "../../src/registry/describe";
import { executeUseCase } from "../../src/registry/execute";
import { integrate } from "../../src/registry/integrate";
import { pull } from "../../src/registry/pull";
import { status } from "../../src/registry/status";
import { TEAM_TIMEOUT, team } from "../support/team-workspace";

setDefaultTimeout(TEAM_TIMEOUT);

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const RULE = "00000000000000000000000000000001";
const DATA: Record<string, Row[]> = {
  sys_db_object: [
    { sys_id: "c0", name: "sys_metadata", super_class: "" },
    { sys_id: "c1", name: "sys_script", super_class: "c0" },
    { sys_id: "t0", name: "task", super_class: "" },
    { sys_id: "t1", name: "incident", super_class: "t0" },
  ],
  sys_scope: [{ sys_id: "global", scope: "global" }],
  sys_dictionary: [
    { sys_id: "d1", name: "sys_script", element: "script", internal_type: "script_server" },
  ],
  sys_script: [
    {
      sys_id: RULE,
      sys_class_name: "sys_script",
      name: "Stamp task",
      collection: "task",
      when: "before",
      order: "100",
      active: "true",
      script: "stamp(current);",
      sys_scope: "global",
    },
  ],
};

const tables = (queries: readonly { table: unknown }[]) => queries.map((q) => String(q.table));

// ADR-0052 end to end: one scheduled publisher, developers who only use git, and a stateless
// runner, all clones of one origin.
group("a team on one shared mirror", () => {
  it("pulls the instance once; every clone continues from git", async () => {
    const t = await team(structuredClone(DATA));
    cleanups.push(t.cleanup);
    const ci = await t.member("svc_ci");
    const full = await executeUseCase(
      pull,
      { instance: "pdi", publish: true },
      ci.at("2026-10-05T12:00:00Z"),
    );
    expect(full.output).toMatchObject({ mode: "full", shared: { published: true } });
    const fullRequests = t.instance.queries.length;

    // A developer who never pulled: status, integrate and describe use git alone.
    const dev = await t.member("dev.one");
    const early = dev.at("2026-10-05T12:05:00Z");
    const seen = await executeUseCase(status, { instance: "pdi" }, early);
    expect(seen.output["instances"]).toMatchObject([
      {
        phase: "never-pulled",
        sharedMirror: { ahead: true, ageMinutes: 5, reachable: true },
        next: "snagentic integrate pdi",
      },
    ]);
    const merged = await executeUseCase(integrate, { instance: "pdi" }, early);
    expect(merged.output["changedFiles"]).toBeGreaterThan(0);
    const after = await executeUseCase(status, { instance: "pdi" }, early);
    expect(after.output["instances"]).toMatchObject([
      { sharedMirror: { ahead: false }, next: "nothing: the mirror is current" },
    ]);
    const described = await executeUseCase(describe, { target: "incident" }, early);
    expect(described.output).toMatchObject({
      table: {
        inherits: ["incident", "task"],
        behavior: { before: [{ name: "Stamp task", inheritedFrom: "task" }] },
      },
    });
    // adopt reads the secret-field catalog the same way.
    const catalog = await early.syncState(dev.root, InstanceName.parse("pdi")).readCatalog();
    expect(catalog?.parents).toMatchObject({ incident: "task", sys_script: "sys_metadata" });
    expect(t.instance.queries.length).toBe(fullRequests);

    // Once the mirror is old, the developer's own pull is only the change since.
    Object.assign(t.instance.tables["sys_script"]?.[0] ?? {}, {
      script: "stamp(current, true);",
      sys_updated_on: "2026-10-05 12:10:00",
    });
    t.instance.queries.length = 0;
    const own = await executeUseCase(pull, { instance: "pdi" }, dev.at("2026-10-05T12:30:00Z"));
    expect(own.output).toMatchObject({ mode: "incremental", records: 1 });
    const delta = tables(t.instance.queries);
    expect(delta.length).toBeLessThan(fullRequests / 2);
    // The catalog a commit carries is data, not trust (spec 014, SEC2-03): before it writes what
    // it pulled, a clone reads the instance's catalog once if it never read that catalog itself.
    expect(delta).toContain("sys_dictionary");

    // A runner that starts empty continues incrementally from the fetched branch, and publishes.
    const runner = await t.member("svc_ci");
    t.instance.queries.length = 0;
    const scheduled = await executeUseCase(
      pull,
      { instance: "pdi", publish: true },
      runner.at("2026-10-05T12:45:00Z"),
    );
    expect(scheduled.output).toMatchObject({
      mode: "incremental",
      records: 1,
      shared: { from: "shared", published: true },
    });
    expect(tables(t.instance.queries).length).toBeLessThan(fullRequests / 2);

    // The shared branch has one line of history: the full pull, then the runner's.
    const history = await runGitOrThrow(
      ["rev-list", "--parents", "refs/heads/servicenow-remote/pdi"],
      t.origin,
    );
    const commits = history.trim().split("\n");
    expect(commits).toHaveLength(2);
    expect(commits.every((line) => line.split(" ").length <= 2)).toBe(true);

    // The developer's integrate takes the newer shared mirror over its own local pull.
    const later = dev.at("2026-10-05T12:50:00Z");
    await executeUseCase(integrate, { instance: "pdi" }, later);
    const tip = await runGitOrThrow(["rev-parse", "servicenow-remote/pdi"], dev.root);
    expect(tip.trim()).toBe(String(scheduled.output["commit"]));
  });
});
