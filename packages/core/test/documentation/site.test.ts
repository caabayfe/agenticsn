import { describe, expect, it } from "bun:test";
import {
  buildSite,
  loadDocumentation,
  type PageSource,
  parseScene,
  siteFiles,
} from "@snagentic/core";
import {
  ALL,
  fakeSources,
  NO_MEDIA,
  PROCESS,
  pages,
  run,
  scene,
  withPage,
} from "../support/docs-fixtures";

async function build(list: readonly PageSource[] = ALL, process: unknown = undefined) {
  const { sources } = fakeSources(list, process === undefined ? {} : { process });
  let written: readonly { path: string; content: string | Uint8Array }[] = [];
  const result = await buildSite({
    ...run,
    sources,
    markdown: { html: (md) => `<md>${md}</md>` },
    output: {
      root: "/ws/.snagentic/site",
      replace: async (files) => {
        written = files;
      },
    },
    media: NO_MEDIA,
  });
  const file = (path: string) => String(written.find((item) => item.path === path)?.content ?? "");
  return { result, written, file };
}

// The assignment page's evidence changed in the mirror since it was pinned.
const STALE = [
  ...ALL.filter((page) => page.path !== pages.assign.path),
  withPage(pages.assign, {
    frontMatter: {
      title: "Assign an incident",
      evidence: {
        E01: {
          record: "sys_ux_list/8a2e7e1fc3a31110ec3f1d0d05013152",
          how: "read the list",
          result: "r",
          hash: "old",
        },
      },
    },
  }),
];

describe("docs build: the site's sections", () => {
  it("writes per process its page, three section homes, shared pages in both views, guides and configure pages", async () => {
    const { result, written } = await build();
    expect(written.map((item) => item.path).sort()).toEqual([
      "animations/asg.html",
      "assets/site.css",
      "index.html",
      "processes/incident/configure/assign.html",
      "processes/incident/configure/index.html",
      "processes/incident/configure/resolve.html",
      "processes/incident/index.html",
      "processes/incident/operate/assign.html",
      "processes/incident/operate/index.html",
      "processes/incident/operate/resolve.html",
      "processes/incident/operate/understand/lifecycle.html",
      "processes/incident/operate/understand/overview.html",
      "processes/incident/use/confirm.html",
      "processes/incident/use/index.html",
      "processes/incident/use/report.html",
      "processes/incident/use/understand/lifecycle.html",
      "processes/incident/use/understand/overview.html",
    ]);
    expect(result.files).toBe(17);
  });

  it("opens each process with its lifecycle and a door for each reader, naming where they work", async () => {
    const { file } = await build();
    const process = file("processes/incident/index.html");
    expect(process).toContain("Get people working again as fast as possible.");
    expect(process).toContain(
      '<a class="door" href="use/index.html"><strong>For end users</strong>',
    );
    expect(process).toContain("<span>Caller</span><span>In Employee Center</span>");
    expect(process).toContain(
      "<span>Service desk agent, Resolver</span><span>In Service Operations Workspace, classic form</span>",
    );
    expect(process).toContain('<a class="door" href="configure/index.html">');
    expect(process).toContain("<strong>In Progress</strong><span>someone is working on it</span>");
    expect(file("index.html")).toContain(
      '<a href="processes/incident/index.html">Incident management</a>',
    );
  });

  it("gives end users their own home: their roles, the shared topics in their view, their capabilities", async () => {
    const { file } = await build();
    const home = file("processes/incident/use/index.html");
    expect(home).toContain("<strong>Caller</strong> — anyone who reports a problem");
    expect(home).not.toContain("Resolver");
    expect(home).toContain(
      'href="../../../processes/incident/use/understand/overview.html">How incident management works</a>',
    );
    expect(home).toContain(
      '<span class="num">1.</span> <a href="../../../processes/incident/use/report.html">Report an incident</a>',
    );
    expect(home).toContain(
      '<span class="num">2.</span> <a href="../../../processes/incident/use/confirm.html">Confirm or reopen the fix</a>',
    );
    expect(home).not.toContain("Assign an incident");
  });

  it("shows each reader only their part of a shared page", async () => {
    const { file } = await build();
    const user = file("processes/incident/use/understand/overview.html");
    const operator = file("processes/incident/operate/understand/overview.html");
    expect(user).toContain("In Employee Center.");
    expect(user).not.toContain("assignment_group");
    expect(user).not.toContain("{for=");
    expect(operator).toContain("assignment_group field routes it");
    expect(operator).not.toContain("In Employee Center.");
    expect(operator).toContain(
      '<a rel="next" href="../../../../processes/incident/operate/understand/lifecycle.html">',
    );
  });
});

describe("docs build: guides and configure pages", () => {
  it("numbers an operator's guide among the operator's capabilities and links the way through", async () => {
    const { file } = await build(STALE);
    const guide = file("processes/incident/operate/assign.html");
    expect(guide).toContain('<span class="num">1.</span> Assign an incident');
    expect(guide).toContain('<span class="kind">Operator guide</span>');
    expect(guide).toContain("For: Service desk agent");
    expect(guide).toContain("Where: Service Operations Workspace, classic form");
    expect(guide).toContain(
      '<a rel="next" href="../../../processes/incident/operate/resolve.html">Resolve an incident →</a>',
    );
    expect(guide).toContain(
      'class="config" href="../../../processes/incident/configure/assign.html">How it is configured</a>',
    );
    expect(guide).toContain('<span class="label label-new">NEW</span>');
    expect(guide).toContain('src="../../../animations/asg.html" sandbox="allow-scripts"');
    expect(guide).toContain("The platform changed since this guide was checked");
    expect(guide).toContain(
      '<details class="verified"><summary>How this page was checked (1 records)</summary>',
    );
  });

  it("links a capability to its counterpart on the other side", async () => {
    const { file } = await build();
    expect(file("processes/incident/operate/resolve.html")).toContain(
      'On the other side, <strong>Caller</strong>: <a href="../../../processes/incident/use/confirm.html">Confirm or reopen the fix</a>',
    );
    expect(file("processes/incident/use/confirm.html")).toContain(
      '<strong>Resolver</strong>: <a href="../../../processes/incident/operate/resolve.html">Resolve an incident</a>',
    );
  });

  it("shares a configure page between counterparts and links back to both guides", async () => {
    const { file } = await build();
    const page = file("processes/incident/configure/resolve.html");
    expect(page).toContain('<span class="kind">Technical reference</span>');
    expect(page).toContain(
      'href="../../../processes/incident/operate/resolve.html">Operator guide: Resolve an incident</a>',
    );
    expect(page).toContain(
      'href="../../../processes/incident/use/confirm.html">User guide: Confirm or reopen the fix</a>',
    );
    expect(page).toContain('<h2 id="evidence">Evidence</h2>');
    expect(file("processes/incident/use/confirm.html")).toContain(
      'href="../../../processes/incident/configure/resolve.html">How it is configured</a>',
    );
  });

  it("lists the configure pages in the order of the capabilities, and shows seen evidence as seen", async () => {
    const { file } = await build();
    const home = file("processes/incident/configure/index.html");
    expect(home.indexOf("Assignment configuration")).toBeLessThan(
      home.indexOf("Resolution configuration"),
    );
    expect(file("processes/incident/use/confirm.html")).toContain(
      '<span class="status status-seen">seen</span>',
    );
    expect(file("index.html")).toContain(
      "Checked against pdi2 on 2026-10-17 (mirror 4db7753abcde)",
    );
  });
});

describe("docs build: defaults and media", () => {
  it("orders shared pages with the overview first when process.yaml doesn't list them", async () => {
    const { understand: _listed, ...unlisted } = PROCESS;
    const { file } = await build(ALL, unlisted);
    const home = file("processes/incident/operate/index.html");
    expect(home.indexOf("How incident management works")).toBeLessThan(
      home.indexOf("The life of an incident"),
    );
  });

  it("lists processes by their order, then by title", async () => {
    const { sources } = fakeSources(ALL, {
      others: [
        { path: "processes/problem/process.yaml", process: { title: "Problem", order: 2 } },
        { path: "processes/change/process.yaml", process: { title: "Change", order: 2 } },
      ],
    });
    const docs = await loadDocumentation(sources, "/ws");
    const index = String(
      siteFiles({
        ...docs,
        processes: [...docs.processes].reverse(),
        statuses: new Map(),
        markdown: (md) => md,
        builtAt: "2026-10-17",
        mirrorCommit: null,
      }).find((item) => item.path === "index.html")?.content,
    );
    const at = (title: string) => index.indexOf(`>${title}</a>`);
    expect(at("Incident management")).toBeLessThan(at("Change"));
    expect(at("Change")).toBeLessThan(at("Problem"));
  });

  it("writes an animation's audio track beside it", async () => {
    const { sources } = fakeSources(ALL);
    const docs = await loadDocumentation(sources, "/ws");
    const files = siteFiles({
      ...docs,
      statuses: new Map(),
      markdown: (md) => md,
      builtAt: "2026-10-17",
      mirrorCommit: null,
      media: new Map([
        [
          "asg",
          {
            player: {
              audio: { mimeType: "audio/mpeg", base64: "AA==" },
              timeline: { starts: [0.7], total: 3 },
            },
            mp3: new Uint8Array([1]),
          },
        ],
      ]),
    });
    expect(files.find((item) => item.path === "animations/asg.mp3")?.content).toEqual(
      new Uint8Array([1]),
    );
    expect(parseScene(scene.path, scene).name).toBe("asg");
  });
});
