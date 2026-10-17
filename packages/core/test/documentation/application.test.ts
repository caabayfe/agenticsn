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

function fakeSources(pages: PageSource[], scenes: SceneSource[] = [], site: unknown = undefined) {
  const pinned = new Map<string, Map<string, string>>();
  const sources: DocumentationSources = {
    site: async () =>
      site === undefined
        ? { title: "Incident docs", instance: "pdi2", footer: "Prepared with snagentic." }
        : site,
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
  pair: { pair?: string } = {},
): PageSource => ({
  path: "pages/B2-assignment.md",
  frontMatter: {
    code: "B2",
    title: "Assignment configuration",
    audience: "technical",
    ...pair,
    evidence,
  },
  body,
});

const guide: PageSource = {
  path: "pages/A2-assignment.md",
  frontMatter: { code: "A2", title: "Assignment", audience: "guide", pair: "B2" },
  body: "## Who gets the incident {label=NEW}\n\nThe group is set for you. [E01]\n\n{{animation:asg}}\n",
};

const scene: SceneSource = {
  path: "animations/asg",
  animation: { name: "asg", title: "Assignment", heading: "How a group is chosen" },
  svg: '<svg viewBox="0 0 960 440"><g id="cam"></g></svg>',
  css: null,
  steps: [{ t: "Saved", c: "The incident is saved.", say: "The incident is saved." }],
};

const record: MirrorRecord = { hash: "aaa", fields: { script: SCRIPT, name: "Set group" } };
const run = { root: "/ws", signal: new AbortController().signal };

describe("docs check", () => {
  it("passes when every piece of evidence still matches the mirror", async () => {
    const { sources } = fakeSources([
      technical({
        E01: {
          record: `sys_script/${RULE}`,
          field: "script",
          hash: sha256Hex(SCRIPT),
          how: "h",
          result: "r",
        },
      }),
    ]);
    const check = await checkDocs({
      ...run,
      sources,
      mirror: () => fakeMirror({ [`sys_script/${RULE}`]: record }),
    });
    expect(check.ok).toBe(true);
    expect(check.evidence.map((item) => item.status)).toEqual(["fresh"]);
  });

  it("fails when the anchored field changed in the mirror", async () => {
    const { sources } = fakeSources([
      technical({
        E01: {
          record: `sys_script/${RULE}`,
          field: "script",
          hash: sha256Hex("old"),
          how: "h",
          result: "r",
        },
      }),
    ]);
    const check = await checkDocs({
      ...run,
      sources,
      mirror: () => fakeMirror({ [`sys_script/${RULE}`]: record }),
    });
    expect(check.ok).toBe(false);
    expect(check.evidence[0]).toMatchObject({
      status: "changed",
      anchor: `sys_script/${RULE}#script`,
    });
  });

  it("fails when the record is gone from the mirror", async () => {
    const { sources } = fakeSources([
      technical({ E01: { record: `sys_script/${RULE}`, hash: "aaa", how: "h", result: "r" } }),
    ]);
    const check = await checkDocs({ ...run, sources, mirror: () => fakeMirror({}) });
    expect(check.ok).toBe(false);
    expect(check.evidence[0]?.status).toBe("missing");
  });

  it("passes unpinned evidence but reports it", async () => {
    const { sources } = fakeSources([
      technical({ E01: { record: `sys_script/${RULE}`, how: "h", result: "r" } }),
    ]);
    const check = await checkDocs({
      ...run,
      sources,
      mirror: () => fakeMirror({ [`sys_script/${RULE}`]: record }),
    });
    expect(check.ok).toBe(true);
    expect(check.evidence[0]?.status).toBe("unpinned");
  });

  it("fails on an animation or a pair page that does not exist", async () => {
    const { sources } = fakeSources([guide]);
    const check = await checkDocs({ ...run, sources, mirror: () => fakeMirror({}) });
    expect(check.ok).toBe(false);
    expect(check.problems).toEqual([
      { kind: "unknown-citation", page: "pages/A2-assignment.md", detail: "E01" },
      { kind: "unknown-animation", page: "pages/A2-assignment.md", detail: "asg" },
      { kind: "unknown-pair", page: "pages/A2-assignment.md", detail: "B2" },
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
    await expect(checkDocs({ ...run, sources, mirror: () => fakeMirror({}) })).rejects.toThrow(
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
    const result = await pinDocs(
      { ...run, sources, mirror: () => fakeMirror({ [`sys_script/${RULE}`]: record }) },
      {},
    );
    expect(pinned.get("pages/B2-assignment.md")).toEqual(
      new Map([
        ["E01", sha256Hex(SCRIPT)],
        ["E02", "aaa"],
      ]),
    );
    expect(result.pinned.map((item) => item.id)).toEqual(["E01", "E02"]);
    expect(result.missing.map((item) => item.id)).toEqual(["E03"]);
  });

  it("pins one page only when asked, by code", async () => {
    const { sources, pinned } = fakeSources([
      technical({ E01: { record: `sys_script/${RULE}`, how: "h", result: "r" } }),
    ]);
    await pinDocs(
      { ...run, sources, mirror: () => fakeMirror({ [`sys_script/${RULE}`]: record }) },
      { page: "A9" },
    );
    expect(pinned.size).toBe(0);
  });
});

describe("docs build", () => {
  it("writes the index, each page, each animation and the stylesheet", async () => {
    const { sources } = fakeSources(
      [
        { ...guide, body: guide.body.replace(" [E01]", "") },
        technical(
          {
            E01: {
              record: `sys_script/${RULE}`,
              hash: "old",
              how: "read the script",
              result: "sets the group",
            },
          },
          undefined,
          { pair: "A2" },
        ),
      ],
      [scene],
    );
    let written: readonly { path: string; content: string }[] = [];
    const result = await buildSite({
      ...run,
      sources,
      mirror: () => fakeMirror({ [`sys_script/${RULE}`]: record }),
      markdown: { html: (md) => `<md>${md}</md>` },
      output: {
        root: "/ws/.snagentic/site",
        replace: async (files) => {
          written = files;
        },
      },
      clock: () => new Date("2026-10-17T10:00:00Z"),
    });
    expect(written.map((file) => file.path).sort()).toEqual([
      "animations/asg.html",
      "assets/site.css",
      "index.html",
      "pages/A2-assignment.html",
      "pages/B2-assignment.html",
    ]);
    expect(result.files).toBe(5);
    const technicalPage =
      written.find((file) => file.path === "pages/B2-assignment.html")?.content ?? "";
    expect(technicalPage).toContain('<a class="cite" href="#E01">E01</a>');
    expect(technicalPage).toContain('<span class="status status-changed">changed</span>');
    expect(technicalPage).toContain("The instance changed since this page was reviewed");
    expect(technicalPage).toContain('href="../pages/A2-assignment.html"');
    const guidePage =
      written.find((file) => file.path === "pages/A2-assignment.html")?.content ?? "";
    expect(guidePage).toContain('<span class="label label-new">NEW</span>');
    expect(guidePage).toContain('src="../animations/asg.html" sandbox="allow-scripts"');
    expect(guidePage).toContain("Transcript (1 steps)");
    const index = written.find((file) => file.path === "index.html")?.content ?? "";
    expect(index).toContain("Checked against pdi2 on 2026-10-17 (mirror commit 4db7753abcde)");
    expect(index.indexOf("A2")).toBeLessThan(index.indexOf("B2"));
  });
});
