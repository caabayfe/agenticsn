import { describe, expect, it } from "bun:test";
import {
  buildSite,
  loadDocumentation,
  type MediaTools,
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
  SITE,
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
      "assets/search.js",
      "assets/site.css",
      "assets/theme/theme.css",
      "index.html",
      "processes/incident/configure/assign.html",
      "processes/incident/configure/index.html",
      "processes/incident/configure/records.html",
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
    expect(result.files).toBe(20);
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
    const page = file("processes/incident/use/index.html");
    const home = page.slice(page.indexOf("<main"), page.indexOf("</main>"));
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

  it("turns see: links into the page's address, in the reader's view", async () => {
    const { file } = await build([
      ...ALL.filter((page) => page.path !== pages.assign.path && page.path !== pages.report.path),
      withPage(pages.assign, {
        body: "Read [the overview](see:overview) and [the process](see:incident). [E01]",
      }),
      withPage(pages.report, { body: "Read [the overview](see:overview). [E01]" }),
    ]);
    expect(file("processes/incident/operate/assign.html")).toContain(
      "[the overview](../../../processes/incident/operate/understand/overview.html)",
    );
    expect(file("processes/incident/operate/assign.html")).toContain(
      "[the process](../../../processes/incident/index.html)",
    );
    expect(file("processes/incident/use/report.html")).toContain(
      "[the overview](../../../processes/incident/use/understand/overview.html)",
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

  it("writes the configuration index: what is documented, by type, and what isn't yet", async () => {
    const { file } = await build(ALL, { ...PROCESS, tables: ["incident"] });
    const records = file("processes/incident/configure/records.html");
    expect(records).toContain("<h2>Documented (4)</h2>");
    expect(records).toContain("<h3>Business rules (1)</h3>");
    expect(records).toContain(
      'href="../../../processes/incident/configure/assign.html">Assignment configuration</a>',
    );
    expect(records).toContain("<h2>Not documented yet (2)</h2>");
    expect(records).toContain("Mark VIP");
    expect(records).toContain("admin, 2026-05-01 10:00:00");
    expect(file("processes/incident/configure/index.html")).toContain(
      'href="../../../processes/incident/configure/records.html">Configuration index',
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

describe("docs build: videos", () => {
  const media = (browser: boolean): MediaTools => ({
    ...NO_MEDIA,
    codec: {
      available: async () => true,
      decode: async () => new Float32Array(10),
      encodeMp3: async () => new Uint8Array([1, 2]),
    },
    video: { available: async () => browser, render: async () => new Uint8Array([9]) },
  });

  async function buildWith(browser: boolean) {
    const { sources } = fakeSources(ALL);
    let written: readonly { path: string; content: string | Uint8Array }[] = [];
    const result = await buildSite(
      {
        ...run,
        sources,
        markdown: { html: (md) => md },
        output: {
          root: "/ws/site",
          replace: async (files) => {
            written = files;
          },
        },
        media: media(browser),
      },
      { video: { fps: 30 } },
    );
    return { result, written };
  }

  it("renders every animation as an MP4 and links it under the player", async () => {
    const { result, written } = await buildWith(true);
    expect(result.videos).toEqual(["asg"]);
    expect(written.find((file) => file.path === "animations/asg.mp4")?.content).toEqual(
      new Uint8Array([9]),
    );
    const page = String(
      written.find((file) => file.path === "processes/incident/operate/assign.html")?.content,
    );
    expect(page).toContain(
      'href="../../../animations/asg.mp4" download>Download the video (MP4)</a>',
    );
  });

  it("cleans the video cache after recording, and reports what it removed", async () => {
    let pruned = 0;
    const { sources } = fakeSources(ALL);
    const result = await buildSite(
      {
        ...run,
        sources,
        markdown: { html: (md) => md },
        output: { root: "/ws/site", replace: async () => {} },
        media: {
          ...media(true),
          video: {
            available: async () => true,
            render: async () => new Uint8Array([9]),
            prune: async () => {
              pruned += 1;
              return 3;
            },
          },
        },
      },
      { video: { fps: 30 } },
    );
    expect(result.videosPruned).toBe(3);
    expect(pruned).toBe(1);
  });

  it("names every animation it could not render, and links no video", async () => {
    const { result, written } = await buildWith(false);
    expect(result.videos).toEqual([]);
    expect(result.videosNotMade).toEqual([
      { animation: "asg", reason: "no Chrome or Chromium browser" },
    ]);
    expect(written.some((file) => file.path.endsWith(".mp4"))).toBe(false);
    expect(result.videosPruned).toBe(0);
  });
});

describe("docs build: media from site.yaml", () => {
  const tools: MediaTools = {
    ...NO_MEDIA,
    codec: {
      available: async () => true,
      decode: async () => new Float32Array(10),
      encodeMp3: async () => new Uint8Array([1, 2]),
    },
    voices: [
      {
        name: "piper",
        available: async () => true,
        speak: async () => new Float32Array(48_000).fill(0.2),
      },
    ],
    video: { available: async () => true, render: async () => new Uint8Array([9]) },
  };

  async function buildFor(media: unknown, options?: Parameters<typeof buildSite>[1]) {
    const { sources } = fakeSources(ALL, { site: { ...SITE, media } });
    return buildSite(
      {
        ...run,
        sources,
        markdown: { html: (md) => md },
        output: { root: "/ws/site", replace: async () => {} },
        media: tools,
      },
      options,
    );
  }

  it("narrates and records the animations as site.yaml asks, when no media option is given", async () => {
    const result = await buildFor({ voice: "none", video: true });
    expect(result.narrated).toEqual(["asg"]);
    expect(result.videos).toEqual(["asg"]);
  });

  it("lets explicit options override site.yaml, down to no media at all", async () => {
    const result = await buildFor({ video: true }, {});
    expect(result.narrated).toEqual([]);
    expect(result.videos).toEqual([]);
  });

  it("lets a flag override only its own setting, keeping the voice site.yaml asks for", async () => {
    const video = await buildFor({ voice: "piper", video: false }, { flags: { video: true } });
    expect(video.voice).toBe("piper");
    expect(video.videos).toEqual(["asg"]);
    const silent = await buildFor({ voice: "piper", video: true }, { flags: { voice: "none" } });
    expect(silent.voice).toBe("none");
    expect(silent.videos).toEqual(["asg"]);
    const none = await buildFor({ voice: "piper", video: true }, { flags: {} });
    expect(none.narrated).toEqual(["asg"]);
    const off = await buildFor(
      { voice: "piper", video: true },
      { flags: { audio: false, voice: "none", video: false } },
    );
    expect(off.narrated).toEqual([]);
    expect(await buildFor(undefined, { flags: { video: true } })).toMatchObject({
      voice: "none",
      videos: ["asg"],
    });
  });

  it("gives an audio track without video when site.yaml asks only for a voice", async () => {
    const result = await buildFor({ voice: "none", audio: true });
    expect(result.narrated).toEqual(["asg"]);
    expect(result.videos).toEqual([]);
  });
});

describe("docs build: sound by the reader's choice", () => {
  it("narrates from the reader's first click unless they turned sound off, and remembers it", async () => {
    const { file } = await build();
    const page = file("processes/incident/operate/assign.html");
    expect(page).toContain('sandbox="allow-scripts" allow="autoplay"');
    expect(page).toContain("on=true");
    expect(page).toContain("localStorage.getItem(K)!=='off'");
    expect(page).toContain("snagenticSoundPref:on");
    expect(page).toContain("addEventListener('pointerdown',go)");
    expect(page).toContain("snagenticActivate:true");
  });

  it("makes Play and a click on the stage play with sound, and tells the page", async () => {
    const { file } = await build();
    const player = file("animations/asg.html");
    expect(player).toContain('root.addEventListener("click", playButton)');
    // The sound button says what a click does, so a reader never turns sound off by mistake.
    expect(player).toContain('Turn sound off"');
    expect(player).not.toContain("Narration on");
    expect(player).toContain("parent.postMessage({ snagenticSound: on }");
    expect(player).toContain("d.snagenticActivate && !activated");
  });
});
