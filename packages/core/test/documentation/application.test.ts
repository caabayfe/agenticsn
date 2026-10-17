import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  buildSite,
  checkDocs,
  type DocumentationSources,
  type MirrorRecord,
  type MirrorRecords,
  NoDocumentationError,
  type PageSource,
  pinDocs,
  type SceneSource,
} from "@snagentic/core";

const sha256Hex = (text: string) => createHash("sha256").update(text).digest("hex");

const RULE = "0c1345dd0783f01028ef0a701ad300fa";
const SCRIPT = "function onBefore() { current.assignment_group = group; }";

const PROCESS = {
  path: "processes/incident/process.yaml",
  process: {
    title: "Incident management",
    summary: "Get people working again as fast as possible.",
    roles: [
      { id: "caller", name: "Caller", description: "anyone who reports a problem" },
      { id: "agent", name: "Service desk agent" },
    ],
    lifecycle: [
      { state: "New", meaning: "logged, nobody working on it yet" },
      { state: "In Progress", meaning: "someone is working on it" },
    ],
    capabilities: [
      {
        id: "report",
        title: "Report an incident",
        summary: "Tell us what is wrong.",
        roles: ["caller"],
      },
      {
        id: "assign",
        title: "Assign an incident",
        summary: "Get it to the right team.",
        roles: ["agent"],
      },
    ],
  },
};

function fakeSources(pages: PageSource[], scenes: SceneSource[] = [], site: unknown = undefined) {
  const pinned = new Map<string, Map<string, string>>();
  const sources: DocumentationSources = {
    site: async () =>
      site === undefined
        ? { title: "Incident docs", instance: "pdi2", footer: "Prepared with snagentic." }
        : site,
    processes: async () => [PROCESS],
    pages: async () => pages,
    scenes: async () => scenes,
    pinHashes: async (path, hashes) => {
      pinned.set(path, new Map(hashes));
    },
  };
  return { sources, pinned };
}

function fakeMirror(records: Record<string, MirrorRecord>): MirrorRecords {
  return {
    read: async (table, sysId) => records[`${table}/${sysId}`] ?? null,
    head: async () => "4db7753abcdef0123456789",
  };
}

const technical = (
  evidence: Record<string, unknown>,
  body = "The rule sets the group. [E01]",
): PageSource => ({
  path: "processes/incident/assign.technical.md",
  frontMatter: { title: "Assignment configuration", evidence },
  body,
});

const assignGuide: PageSource = {
  path: "processes/incident/assign.guide.md",
  frontMatter: { title: "Assign an incident" },
  body: "## Who gets the incident {label=NEW}\n\nThe group is set for you. [E01]\n\n{{animation:asg}}\n",
};

const reportGuide: PageSource = {
  path: "processes/incident/report.guide.md",
  frontMatter: { title: "Report an incident" },
  body: "Open the portal.",
};

const overview: PageSource = {
  path: "processes/incident/overview.guide.md",
  frontMatter: { title: "Incident management" },
  body: "An incident is anything that stops you working.",
};

const scene: SceneSource = {
  path: "animations/asg",
  animation: { name: "asg", title: "Assignment", heading: "How a group is chosen" },
  svg: '<svg viewBox="0 0 960 440"><g id="cam"></g></svg>',
  css: null,
  steps: [{ t: "Saved", c: "The incident is saved.", say: "The incident is saved." }],
};

const record: MirrorRecord = { hash: "aaa", fields: { script: SCRIPT, name: "Set group" } };
const mirrored = () => fakeMirror({ [`sys_script/${RULE}`]: record });
const run = { root: "/ws", signal: new AbortController().signal };
const evidence = (extra: Record<string, unknown>) => ({
  E01: { record: `sys_script/${RULE}`, how: "read it", result: "sets the group", ...extra },
});

describe("docs check", () => {
  it("passes when every piece of evidence still matches the mirror", async () => {
    const { sources } = fakeSources([
      reportGuide,
      { ...assignGuide, body: "Done for you." },
      technical(evidence({ field: "script", hash: sha256Hex(SCRIPT) })),
    ]);
    const check = await checkDocs({ ...run, sources, mirror: mirrored });
    expect(check.ok).toBe(true);
    expect(check.processes).toBe(1);
    expect(check.evidence.map((item) => item.status)).toEqual(["fresh"]);
  });

  it("fails when the anchored field changed in the mirror", async () => {
    const { sources } = fakeSources([
      technical(evidence({ field: "script", hash: sha256Hex("old") })),
    ]);
    const check = await checkDocs({ ...run, sources, mirror: mirrored });
    expect(check.ok).toBe(false);
    expect(check.evidence[0]).toMatchObject({
      status: "changed",
      anchor: `sys_script/${RULE}#script`,
    });
  });

  it("fails when the record is gone from the mirror", async () => {
    const { sources } = fakeSources([technical(evidence({ hash: "aaa" }))]);
    const check = await checkDocs({ ...run, sources, mirror: () => fakeMirror({}) });
    expect(check.ok).toBe(false);
    expect(check.evidence[0]?.status).toBe("missing");
  });

  it("passes unpinned evidence but reports it", async () => {
    const { sources } = fakeSources([technical(evidence({}))]);
    const check = await checkDocs({ ...run, sources, mirror: mirrored });
    expect(check.ok).toBe(true);
    expect(check.evidence[0]?.status).toBe("unpinned");
  });

  it("reports capabilities without a user guide, without failing", async () => {
    const { sources } = fakeSources([reportGuide]);
    const check = await checkDocs({ ...run, sources, mirror: mirrored });
    expect(check.ok).toBe(true);
    expect(check.problems).toEqual([
      { kind: "missing-guide", page: "processes/incident/process.yaml", detail: "assign" },
    ]);
  });

  it("fails on unknown citations, animations, capabilities and processes", async () => {
    const { sources } = fakeSources([
      reportGuide,
      assignGuide,
      {
        path: "processes/incident/escalate.guide.md",
        frontMatter: { title: "Escalate" },
        body: "",
      },
      { path: "processes/problem/overview.guide.md", frontMatter: { title: "Problem" }, body: "" },
    ]);
    const check = await checkDocs({ ...run, sources, mirror: mirrored });
    expect(check.ok).toBe(false);
    expect(check.problems).toEqual([
      { kind: "unknown-citation", page: "processes/incident/assign.guide.md", detail: "E01" },
      { kind: "unknown-animation", page: "processes/incident/assign.guide.md", detail: "asg" },
      {
        kind: "unknown-capability",
        page: "processes/incident/escalate.guide.md",
        detail: "escalate",
      },
      { kind: "unknown-process", page: "processes/problem/overview.guide.md", detail: "problem" },
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
        return fakeMirror({});
      },
    });
    expect(asked).toEqual(["pdi2"]);
  });

  it("explains how to start when the workspace has no documentation", async () => {
    const { sources } = fakeSources([], [], null);
    await expect(checkDocs({ ...run, sources, mirror: mirrored })).rejects.toThrow(
      NoDocumentationError,
    );
  });
});

describe("docs pin", () => {
  it("records the mirror's current hash for changed and unpinned evidence, and lists what is gone", async () => {
    const { sources, pinned } = fakeSources([
      technical(
        {
          E01: {
            record: `sys_script/${RULE}`,
            field: "script",
            hash: "old",
            how: "h",
            result: "r",
          },
          E02: { record: `sys_script/${RULE}`, how: "h", result: "r" },
          E03: {
            record: "sys_script/ffff0000000000000000000000000000",
            hash: "x",
            how: "h",
            result: "r",
          },
        },
        "[E01] [E02] [E03]",
      ),
    ]);
    const result = await pinDocs({ ...run, sources, mirror: mirrored }, {});
    expect(pinned.get("processes/incident/assign.technical.md")).toEqual(
      new Map([
        ["E01", sha256Hex(SCRIPT)],
        ["E02", "aaa"],
      ]),
    );
    expect(result.pinned.map((item) => item.id)).toEqual(["E01", "E02"]);
    expect(result.missing.map((item) => item.id)).toEqual(["E03"]);
  });

  it("pins the pages of one capability, or nothing when none match", async () => {
    const { sources, pinned } = fakeSources([technical(evidence({}))]);
    await pinDocs({ ...run, sources, mirror: mirrored }, { page: "incident/report" });
    expect(pinned.size).toBe(0);
    await pinDocs({ ...run, sources, mirror: mirrored }, { page: "incident/assign" });
    expect(pinned.size).toBe(1);
  });
});

describe("docs build", () => {
  async function build(pages: PageSource[]) {
    const { sources } = fakeSources(pages, [scene]);
    let written: readonly { path: string; content: string }[] = [];
    const result = await buildSite({
      ...run,
      sources,
      mirror: mirrored,
      markdown: { html: (md) => `<md>${md}</md>` },
      output: {
        root: "/ws/.snagentic/site",
        replace: async (files) => {
          written = files;
        },
      },
      clock: () => new Date("2026-10-17T10:00:00Z"),
    });
    const file = (path: string) => written.find((item) => item.path === path)?.content ?? "";
    return { result, written, file };
  }

  const all = [
    overview,
    reportGuide,
    { ...assignGuide, body: assignGuide.body.replace(" [E01]", "") },
    technical(evidence({ hash: "old" })),
  ];

  it("writes the index, a page per process, each capability's pages, animations and the stylesheet", async () => {
    const { result, written } = await build(all);
    expect(written.map((item) => item.path).sort()).toEqual([
      "animations/asg.html",
      "assets/site.css",
      "index.html",
      "processes/incident/assign.html",
      "processes/incident/assign.technical.html",
      "processes/incident/index.html",
      "processes/incident/report.html",
    ]);
    expect(result.files).toBe(7);
  });

  it("presents the process to its consumers: roles, where each starts, lifecycle and numbered capabilities", async () => {
    const { file } = await build(all);
    const process = file("processes/incident/index.html");
    expect(process).toContain("Get people working again as fast as possible.");
    expect(process).toContain("<strong>Caller</strong> — anyone who reports a problem");
    expect(process).toContain('Start with:</span> <a href="report.html">Report an incident</a>');
    expect(process).toContain("<strong>In Progress</strong><span>someone is working on it</span>");
    expect(process).toContain("An incident is anything that stops you working.");
    expect(process).toContain(
      '<span class="num">2.</span> <a href="assign.html">Assign an incident</a>',
    );
    expect(file("index.html")).toContain(
      '<a href="processes/incident/index.html">Incident management</a>',
    );
  });

  it("gives each guide its audience, its place in the process and the way to the next step", async () => {
    const { file } = await build(all);
    const guide = file("processes/incident/assign.html");
    expect(guide).toContain('<span class="num">2.</span> Assign an incident');
    expect(guide).toContain("For: Service desk agent");
    expect(guide).toContain('<a rel="prev" href="report.html">← Report an incident</a>');
    expect(guide).toContain('href="assign.technical.html">How it is configured</a>');
    expect(guide).toContain('<span class="label label-new">NEW</span>');
    expect(guide).toContain('src="../../animations/asg.html" sandbox="allow-scripts"');
    expect(guide).toContain("The platform changed since this guide was checked");
  });

  it("keeps configuration evidence on the technical page and links back to the guide", async () => {
    const { file } = await build(all);
    const page = file("processes/incident/assign.technical.html");
    expect(page).toContain('<a class="cite" href="#E01">E01</a>');
    expect(page).toContain('<span class="status status-changed">changed</span>');
    expect(page).toContain("The instance changed since this page was reviewed");
    expect(page).toContain(
      'href="../../processes/incident/assign.html">User guide: Assign an incident</a>',
    );
    expect(file("index.html")).toContain(
      "Checked against pdi2 on 2026-10-17 (mirror 4db7753abcde)",
    );
  });

  it("shows a guide's own evidence folded, for readers who want to know how it was checked", async () => {
    const { file } = await build([
      {
        ...reportGuide,
        frontMatter: { title: "Report", evidence: evidence({ hash: "aaa" }) },
        body: "Use the portal. [E01]",
      },
    ]);
    const guide = file("processes/incident/report.html");
    expect(guide).toContain(
      '<details class="verified"><summary>How this guide was checked (1 records)</summary>',
    );
    expect(guide).toContain('<a class="cite" href="#E01">E01</a>');
  });
});
