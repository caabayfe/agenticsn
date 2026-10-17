import { describe, expect, it } from "bun:test";
import { checkDocs, NoDocumentationError, pinDocs } from "@snagentic/core";
import {
  ALL,
  fakeMirror,
  fakeSources,
  PROCESS,
  pages,
  RULE,
  run,
  SCRIPT,
  sha256Hex,
  withPage,
} from "../support/docs-fixtures";

const without = (...paths: string[]) => ALL.filter((page) => !paths.includes(page.path));
const problemsOf = async (list = ALL, options = {}) => {
  const { sources } = fakeSources(list, options);
  return checkDocs({ ...run, sources });
};
const process = (change: (capabilities: typeof PROCESS.capabilities) => unknown[]) => ({
  ...PROCESS,
  capabilities: change(PROCESS.capabilities),
});

describe("docs check: evidence", () => {
  it("passes a complete process: shared pages, guides for both readers, configure pages", async () => {
    const check = await problemsOf();
    expect(check.problems).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.pages).toBe(8);
    expect(new Set(check.evidence.map((item) => item.status))).toEqual(new Set(["fresh", "seen"]));
  });

  it("fails when the anchored field changed in the mirror", async () => {
    const changed = { hash: "aaa", fields: { script: "new()" } };
    const { sources } = fakeSources(ALL);
    const check = await checkDocs({
      ...run,
      sources,
      mirror: () => fakeMirror({ [`sys_script/${RULE}`]: changed }),
    });
    expect(check.ok).toBe(false);
    expect(check.evidence.find((item) => item.page === pages.configureAssign.path)).toMatchObject({
      status: "changed",
      anchor: `sys_script/${RULE}#script`,
    });
  });

  it("fails when a record is gone from the mirror", async () => {
    const { sources } = fakeSources(ALL);
    const check = await checkDocs({ ...run, sources, mirror: () => fakeMirror({}) });
    expect(check.ok).toBe(false);
    expect(check.evidence.filter((item) => item.status === "missing")).toHaveLength(5);
  });

  it("asks for a person's check of a screen to be redone after 90 days, without failing", async () => {
    const { sources } = fakeSources(ALL);
    const check = await checkDocs({ ...run, sources, clock: () => new Date("2027-01-15") });
    expect(check.ok).toBe(true);
    expect(check.problems).toEqual([
      {
        kind: "recheck-seen",
        severity: "warning",
        page: pages.confirm.path,
        detail: "E01 seen by A. Reviewer on 2026-10-01: Employee Center › My Requests",
      },
    ]);
  });

  it("checks against the mirror of the instance named in site.yaml", async () => {
    const asked: string[] = [];
    const { sources } = fakeSources([]);
    await checkDocs({
      ...run,
      sources,
      mirror: (instance) => {
        asked.push(instance);
        return fakeMirror();
      },
    });
    expect(asked).toEqual(["pdi2"]);
  });

  it("explains how to start when the workspace has no documentation", async () => {
    const { sources } = fakeSources([], { site: null });
    await expect(checkDocs({ ...run, sources })).rejects.toThrow(NoDocumentationError);
  });
});

describe("docs check: sections and readers", () => {
  it("fails a capability whose roles are both end users and operators", async () => {
    const check = await problemsOf(ALL, {
      process: process((list) =>
        list.map((item) => (item.id === "assign" ? { ...item, roles: ["agent", "caller"] } : item)),
      ),
    });
    expect(check.ok).toBe(false);
    expect(check.problems).toContainEqual({
      kind: "mixed-audience",
      severity: "error",
      page: "processes/incident/process.yaml",
      detail: "assign",
    });
  });

  it("fails an operator's capability written as an end user's page", async () => {
    const check = await problemsOf([
      ...ALL,
      withPage(pages.assign, { path: "processes/incident/use/assign.md" }),
    ]);
    expect(check.ok).toBe(false);
    expect(check.problems).toContainEqual({
      kind: "wrong-section",
      severity: "error",
      page: "processes/incident/use/assign.md",
      detail: "assign is for operators",
    });
  });

  it("fails a counterpart that doesn't point back", async () => {
    const check = await problemsOf(ALL, {
      process: process((list) =>
        list.map((item) => {
          if (item.id !== "confirm") {
            return item;
          }
          const { counterpart: _dropped, ...rest } = item;
          return rest;
        }),
      ),
    });
    expect(check.problems).toContainEqual({
      kind: "bad-counterpart",
      severity: "error",
      page: "processes/incident/process.yaml",
      detail: "resolve → confirm",
    });
  });

  it("fails an operator's capability with no configure page", async () => {
    const check = await problemsOf(without(pages.configureAssign.path));
    expect(check.ok).toBe(false);
    expect(check.problems).toContainEqual({
      kind: "missing-configure",
      severity: "error",
      page: "processes/incident/process.yaml",
      detail: "assign → configure/assign.md",
    });
  });

  it("fails shared pages that aren't listed, and unknown capabilities and processes", async () => {
    const check = await problemsOf([
      ...ALL,
      { path: "processes/incident/understand/history.md", frontMatter: { title: "H" }, body: "" },
      { path: "processes/incident/operate/escalate.md", frontMatter: { title: "E" }, body: "" },
      { path: "processes/problem/use/report.md", frontMatter: { title: "P" }, body: "" },
    ]);
    const errors = check.problems.filter((problem) => problem.severity === "error");
    expect(errors.map((problem) => [problem.kind, problem.detail])).toEqual([
      ["unknown-topic", "history"],
      ["unknown-capability", "escalate"],
      ["unknown-process", "problem"],
    ]);
  });

  it("fails a link to a page that doesn't exist, and passes one that does", async () => {
    const check = await problemsOf([
      ...without(pages.assign.path),
      withPage(pages.assign, {
        body: `${pages.assign.body}\nSee [resolving](see:resolve), [problems](see:problem/raise).\n`,
      }),
    ]);
    expect(check.ok).toBe(false);
    expect(check.problems).toEqual([
      {
        kind: "unknown-reference",
        severity: "error",
        page: pages.assign.path,
        detail: "see:problem/raise",
      },
    ]);
  });

  it("reports missing pages and roles with nothing to do, without failing", async () => {
    const check = await problemsOf(without(pages.lifecycle.path, pages.report.path), {
      process: { ...PROCESS, roles: [...PROCESS.roles, { id: "lead", audience: "operator" }] },
    });
    expect(check.ok).toBe(true);
    expect(check.problems.map((problem) => [problem.kind, problem.detail])).toEqual([
      ["missing-page", "use/report.md"],
      ["missing-page", "understand/lifecycle.md"],
      ["unused-role", "lead"],
    ]);
  });

  it("warns about platform words in what end users read, including the user view of shared pages", async () => {
    const check = await problemsOf([
      ...without(pages.report.path, pages.lifecycle.path),
      withPage(pages.report, { body: "Set state=3 and fill caller_id; add work notes. [E01]" }),
      withPage(pages.lifecycle, { body: "The incident_state moves on." }),
    ]);
    expect(check.ok).toBe(true);
    expect(check.problems).toEqual([
      {
        kind: "platform-words",
        severity: "warning",
        page: pages.report.path,
        detail: "caller_id, state=3, work notes",
      },
      {
        kind: "platform-words",
        severity: "warning",
        page: pages.lifecycle.path,
        detail: "incident_state",
      },
    ]);
  });

  it("warns about a guide that cites nothing from its reader's screens", async () => {
    const check = await problemsOf([
      ...without(pages.assign.path),
      withPage(pages.assign, {
        frontMatter: {
          title: "Assign",
          evidence: { E01: { record: `sys_script/${RULE}`, how: "h", result: "r" } },
        },
        body: "Done for you. [E01]",
      }),
    ]);
    expect(check.problems).toEqual([
      {
        kind: "unchecked-surface",
        severity: "warning",
        page: pages.assign.path,
        detail: "no evidence from the operator's screens",
      },
    ]);
  });
});

describe("docs pin", () => {
  const technical = withPage(pages.configureAssign, {
    frontMatter: {
      title: "Assignment configuration",
      evidence: {
        E01: { record: `sys_script/${RULE}`, field: "script", hash: "old", how: "h", result: "r" },
        E02: { record: `sys_script/${RULE}`, how: "h", result: "r" },
        E03: { record: "sys_script/ffff0000000000000000000000000000", hash: "x", how: "h" },
      },
    },
    body: "[E01] [E02] [E03]",
  });

  it("records the mirror's current hash for changed and unpinned evidence, and lists what is gone", async () => {
    const { sources, pinned } = fakeSources([technical]);
    const result = await pinDocs({ ...run, sources }, {});
    expect(pinned.get(pages.configureAssign.path)).toEqual(
      new Map([
        ["E01", sha256Hex(SCRIPT)],
        ["E02", "aaa"],
      ]),
    );
    expect(result.pinned.map((item) => item.id)).toEqual(["E01", "E02"]);
    expect(result.missing.map((item) => item.id)).toEqual(["E03"]);
  });

  it("never pins a person's check of a screen", async () => {
    const { sources, pinned } = fakeSources([pages.confirm]);
    const result = await pinDocs({ ...run, sources }, {});
    expect(result.pinned).toEqual([]);
    expect(pinned.size).toBe(0);
  });

  it("pins a topic in every section, one section's topic, or nothing when none match", async () => {
    const unpinned = withPage(pages.resolve, {
      frontMatter: {
        title: "Resolve",
        evidence: { E01: { record: `sys_script/${RULE}`, how: "h", result: "r" } },
      },
    });
    const { sources, pinned } = fakeSources([technical, unpinned]);
    await pinDocs({ ...run, sources }, { page: "incident/report" });
    expect(pinned.size).toBe(0);
    await pinDocs({ ...run, sources }, { page: "incident/operate/resolve" });
    expect([...pinned.keys()]).toEqual([pages.resolve.path]);
    await pinDocs({ ...run, sources }, { page: "incident/assign" });
    expect([...pinned.keys()]).toEqual([pages.resolve.path, pages.configureAssign.path]);
  });
});
