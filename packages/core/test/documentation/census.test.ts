import { describe, expect, it } from "bun:test";
import {
  ancestorsOf,
  checkDocs,
  coverage,
  docsCensus,
  featureProblems,
  type MirrorListing,
  type MirrorRecords,
  parseFeatures,
  parseProcess,
  takeCensus,
  undecided,
} from "@snagentic/core";
import { ALL, fakeMirror, fakeSources, PROCESS, run } from "../support/docs-fixtures";

// The census of a process and the decision on each feature (ADR-0040).

const listing = (scope: string, sysId: string, fields: Record<string, string>): MirrorListing => ({
  sysId,
  scope,
  fields,
});

const TABLES: Record<string, MirrorListing[]> = {
  sys_db_object: [
    listing("global", "t1", { name: "task", super_class: "" }),
    listing("global", "t2", { name: "incident", super_class: "t1" }),
  ],
  sys_app_application: [
    listing("sn_comm", "m1", { title: "Task Communications Management" }),
    listing("sn_comm", "m2", { title: "Communications" }),
  ],
  sys_ui_action: [
    listing("global", "a1", { name: "Resolve", table: "incident" }),
    listing("global", "a2", { name: "Assign to me", table: "task" }),
    listing("global", "a3", { name: "Old", table: "incident", active: "false" }),
    listing("global", "a4", { name: "Approve", table: "change_request" }),
  ],
  sys_declarative_action_assignment: [
    listing("sn_ws", "d1", { label: "Copy Incident", table: "incident" }),
    listing("sn_ws", "d2", { label: "Create Knowledge", table: "incident" }),
  ],
  sys_dictionary: [
    listing("sn_comm", "r1", { name: "comm_plan", element: "source", reference: "task" }),
    listing("global", "r2", { name: "task_sla", element: "task", reference: "task" }),
    listing("global", "r3", { name: "incident_task", element: "incident", reference: "incident" }),
  ],
};

function mirror(withFind = true): MirrorRecords & { searched: string[] } {
  const searched: string[] = [];
  const base = { ...fakeMirror(), list: async (table: string) => TABLES[table] ?? [] };
  return withFind
    ? {
        ...base,
        searched,
        find: async (table, field, values) => {
          searched.push(`${table}.${field}`);
          return (TABLES[table] ?? []).filter((item) => values.includes(item.fields[field] ?? ""));
        },
      }
    : { ...base, searched };
}

const INCIDENT = parseProcess("processes/incident/process.yaml", {
  ...PROCESS,
  tables: ["incident"],
});

const FEATURES = {
  features: [
    {
      id: "core",
      title: "Incident handling",
      found: ["global", "sn_ws:Copy Incident"],
      status: "documented",
      capabilities: ["report", "assign"],
    },
    {
      id: "communication-plans",
      title: "Communication plans",
      found: ["sn_comm"],
      status: "documented",
      capabilities: ["major-incident/communicate"],
    },
  ],
};

describe("the census of a process", () => {
  it("follows the tables a process's tables extend", () => {
    expect(ancestorsOf(["incident"], TABLES["sys_db_object"] ?? [])).toEqual(["task"]);
    expect(ancestorsOf(["task"], TABLES["sys_db_object"] ?? [])).toEqual([]);
  });

  it("groups what reaches the tables by application, the platform's own first", async () => {
    const groups = await takeCensus(INCIDENT, mirror(), run.signal);
    expect(groups.map((group) => [group.scope, group.title, group.records])).toEqual([
      ["global", "Platform (global)", 3],
      ["sn_ws", "sn_ws", 2],
      ["sn_comm", "Communications", 1],
    ]);
    expect(groups[0]?.items).toEqual([
      { kind: "Form and list actions", count: 2, names: ["Assign to me", "Resolve"] },
      { kind: "Tables that refer to it", count: 1, names: ["incident_task"] },
    ]);
    expect(groups[2]?.items).toEqual([
      { kind: "Tables that refer to it", count: 1, names: ["comm_plan"] },
    ]);
  });

  it("filters large tables in the mirror when it can, and lists them when it can't", async () => {
    const fast = mirror();
    await takeCensus(INCIDENT, fast, run.signal);
    expect(fast.searched).toContain("sys_dictionary.reference");
    const slow = await takeCensus(INCIDENT, mirror(false), run.signal);
    expect(slow.map((group) => group.records)).toEqual([3, 2, 1]);
    const tableless = parseProcess("processes/incident/process.yaml", PROCESS);
    expect(await takeCensus(tableless, mirror(), run.signal)).toEqual([]);
  });
});

describe("features.yaml", () => {
  const declared = parseFeatures("processes/incident/features.yaml", FEATURES);

  it("leaves undecided what no feature claims, whole or by name", async () => {
    const groups = await takeCensus(INCIDENT, mirror(), run.signal);
    expect(undecided(groups, declared)).toEqual([
      {
        scope: "sn_ws",
        title: "sn_ws",
        records: 1,
        items: [{ kind: "Workspace actions", count: 1, names: ["Create Knowledge"] }],
      },
    ]);
    expect(coverage(declared)).toEqual({ documented: 2, total: 2 });
  });

  it("checks that a documented feature names capabilities that exist, here or in another process", () => {
    const major = parseProcess("processes/major-incident/process.yaml", {
      ...PROCESS,
      capabilities: [{ id: "communicate", title: "Communicate", roles: ["agent"] }],
    });
    expect(featureProblems(declared, [INCIDENT, major])).toEqual([]);
    expect(featureProblems(declared, [INCIDENT])).toEqual([
      {
        kind: "undocumented-feature",
        detail: "communication-plans: no capability major-incident/communicate",
      },
    ]);
    const bare = parseFeatures("processes/incident/features.yaml", {
      features: [{ id: "x", found: ["a"], status: "documented" }],
    });
    expect(featureProblems(bare, [INCIDENT])).toEqual([
      { kind: "undocumented-feature", detail: "x: names no capability" },
    ]);
    expect(featureProblems(bare, [])).toEqual([{ kind: "unknown-process", detail: "incident" }]);
  });

  it("refuses a feature without a decision it can read", () => {
    const parse = (feature: unknown) => () =>
      parseFeatures("processes/incident/features.yaml", { features: [feature] });
    expect(parse({ id: "Bad Id", found: ["a"], status: "todo" })).toThrow(/kebab-case/);
    expect(parse({ id: "x", found: ["a"], status: "maybe" })).toThrow(/status must be/);
    expect(parse({ id: "x", found: ["a"], status: "out-of-scope" })).toThrow(/needs a note/);
    expect(parse({ id: "x", status: "todo" })).toThrow(/found .* or seen/);
    expect(parse({ id: "x", status: "todo", seen: { by: "me" } })).toThrow(/seen needs/);
    expect(
      parseFeatures("processes/incident/features.yaml", {
        features: [
          { id: "x", status: "todo", seen: { by: "me", on: "2026-10-18", where: "header" } },
        ],
      }).features[0]?.seen,
    ).toEqual({ by: "me", on: "2026-10-18", where: "header" });
    expect(() =>
      parseFeatures("processes/incident/features.yaml", {
        features: [
          { id: "x", found: ["a"], status: "todo" },
          { id: "x", found: ["b"], status: "todo" },
        ],
      }),
    ).toThrow(/listed twice/);
  });
});

describe("docs census and docs check", () => {
  const sources = (features?: unknown) => {
    const { sources: base } = fakeSources(ALL, { process: { ...PROCESS, tables: ["incident"] } });
    return features === undefined
      ? base
      : { ...base, features: async () => [{ path: "processes/incident/features.yaml", features }] };
  };

  it("names what each feature claims and lists what is undecided", async () => {
    const census = await docsCensus(
      { ...run, sources: sources(FEATURES), mirror: () => mirror() },
      "incident",
    );
    expect(census.groups.map((group) => [group.scope, group.features])).toEqual([
      ["global", ["core"]],
      ["sn_ws", ["core"]],
      ["sn_comm", ["communication-plans"]],
    ]);
    expect(census.undecided.map((group) => group.scope)).toEqual(["sn_ws"]);
    const none = await docsCensus(
      { ...run, sources: sources(), mirror: () => mirror() },
      "incident",
    );
    expect(none.declared).toBeNull();
    expect(none.undecided).toHaveLength(3);
    await expect(
      docsCensus({ ...run, sources: sources(), mirror: () => mirror() }, "nope"),
    ).rejects.toThrow(/no process nope/);
  });

  it("warns in docs check about an undecided application, only where features.yaml exists", async () => {
    const check = await checkDocs({ ...run, sources: sources(FEATURES), mirror: () => mirror() });
    expect(check.problems).toContainEqual({
      kind: "undecided-feature",
      severity: "warning",
      page: "processes/incident/features.yaml",
      detail: "sn_ws (sn_ws): workspace actions: Create Knowledge",
    });
    expect(check.problems).toContainEqual({
      kind: "undocumented-feature",
      severity: "error",
      page: "processes/incident/features.yaml",
      detail: "communication-plans: no capability major-incident/communicate",
    });
    const without = await checkDocs({ ...run, sources: sources(), mirror: () => mirror() });
    expect(without.problems.some((problem) => problem.kind === "undecided-feature")).toBe(false);
  });
});
