import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bunMarkdown } from "../../src/adapters/documentation/bun-markdown";
import { FsDocumentationSources } from "../../src/adapters/documentation/fs-documentation-sources";
import { FsMirrorRecords } from "../../src/adapters/documentation/fs-mirror-records";
import { FsSiteOutput } from "../../src/adapters/documentation/fs-site-output";
import { FsWorkspaceStore } from "../../src/adapters/workspace/fs-workspace-store";
import { docsBuild } from "../../src/registry/docs-build";
import { docsCensus } from "../../src/registry/docs-census";
import { docsCheck } from "../../src/registry/docs-check";
import { docsPin } from "../../src/registry/docs-pin";
import { docsServe } from "../../src/registry/docs-serve";
import { docsVideo } from "../../src/registry/docs-video";
import type { UseCaseContext } from "../../src/registry/use-case";
import { FAKE_CONTEXT } from "../support/fakes";

const RULE = "0c1345dd0783f01028ef0a701ad300fa";
const RECORD = `instances/pdi2/metadata/global/sys_script/set-group--${RULE}.yaml`;
const PAGE = "documentation/processes/incident/configure/assign.md";

let base: string;
let root: string;
let served: { port: number } | null;
const progress: string[] = [];

function write(path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function context(): UseCaseContext {
  return {
    ...FAKE_CONTEXT,
    workspaces: new FsWorkspaceStore(),
    host: { ...FAKE_CONTEXT.host, cwd: root },
    documentation: (workspace) => ({
      sources: new FsDocumentationSources(workspace),
      mirror: () =>
        new FsMirrorRecords(join(workspace, "instances/pdi2/metadata"), async () => null),
      markdown: bunMarkdown,
      output: new FsSiteOutput(join(workspace, ".snagentic/site")),
      media: {
        codec: {
          available: async () => true,
          decode: async () => new Float32Array(0),
          encodeMp3: async (samples) => new Uint8Array([samples.length > 0 ? 1 : 0, 2, 3]),
        },
        voices: [
          {
            name: "fake",
            available: async () => true,
            speak: async () => new Float32Array(48_000).fill(0.2),
          },
        ],
        assets: { bed: async () => null, sound: async () => null },
        video: { available: async () => true, render: async () => new Uint8Array(0) },
        videos: { write: async (name) => `/videos/${name}.mp4` },
      },
      serve: async (port, _signal, ready) => {
        served = { port };
        ready(`http://127.0.0.1:${port}/`);
      },
    }),
  };
}

const run = {
  signal: new AbortController().signal,
  progress: (event: { message: string }) => progress.push(event.message),
};

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), "snagentic-docs-cli-"));
  root = join(base, "w");
  await new FsWorkspaceStore().create(root, { layout: 2, createdWith: "test" });
  served = null;
  progress.length = 0;
  write("documentation/site.yaml", "title: Incident docs\ninstance: pdi2\n");
  write(
    "documentation/processes/incident/process.yaml",
    "title: Incident management\ncapabilities:\n  - id: assign\n    title: Assign an incident\n",
  );
  write(RECORD, "_meta:\n  hash: h1\nname: Set group\n");
  write(
    PAGE,
    `---\ntitle: Assignment configuration\nevidence:\n  E01:\n    record: sys_script/${RULE}\n    how: read it\n    result: sets the group\n---\nThe rule sets the group. [E01]\n`,
  );
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("snagentic docs", () => {
  it("census lists the applications that reach the process, from the mirror (ADR-0040)", async () => {
    write(
      "documentation/processes/incident/process.yaml",
      "title: Incident management\ntables: [incident]\ncapabilities:\n  - id: assign\n    title: Assign an incident\n",
    );
    write(RECORD, "_meta:\n  hash: h1\nname: Set group\ncollection: incident\n");
    const output = await docsCensus.handle({ process: "incident" }, context(), run);
    expect(output).toEqual({
      process: "incident",
      tables: ["incident"],
      groups: [
        {
          scope: "global",
          title: "Platform (global)",
          records: 1,
          items: [{ kind: "Business rules", count: 1, names: ["Set group"] }],
          features: [],
        },
      ],
      undecided: [expect.objectContaining({ scope: "global" })],
      declared: false,
    });
    expect(progress).toContain("reading the mirror for everything that reaches the process");
  });

  it("check reports unpinned evidence and passes; pin records the hash; a mirror change then fails", async () => {
    const first = await docsCheck.handle({}, context(), run);
    expect(first.ok).toBe(true);
    expect(docsCheck.exitCode(first)).toBe(0);
    expect(docsCheck.render(first, "text")).toContain(
      "unpinned  processes/incident/configure/assign.md E01",
    );

    const pinned = await docsPin.handle({}, context(), run);
    expect(pinned.pinned.map((item) => item.id)).toEqual(["E01"]);
    expect(docsPin.exitCode(pinned)).toBe(0);
    expect(docsPin.render(pinned, "text")).toContain(
      "pinned 1 evidence\n  processes/incident/configure/assign.md E01",
    );
    expect(readFileSync(join(root, PAGE), "utf8")).toContain("hash: h1");

    write(RECORD, "_meta:\n  hash: h2\nname: Set group\n");
    const stale = await docsCheck.handle({}, context(), run);
    expect(stale.ok).toBe(false);
    expect(docsCheck.exitCode(stale)).toBe(1);
    expect(docsCheck.render(stale, "text")).toContain("documentation is out of date");
  });

  it("pin lists evidence whose record is gone and exits 1", async () => {
    rmSync(join(root, RECORD));
    const result = await docsPin.handle({ page: "incident/assign" }, context(), run);
    expect(result.missing.map((item) => item.id)).toEqual(["E01"]);
    expect(docsPin.exitCode(result)).toBe(1);
    expect(docsPin.render(result, "text")).toContain("gone from the mirror");
  });

  it("build writes the site and says when pages are out of date", async () => {
    write(
      PAGE,
      readFileSync(join(root, PAGE), "utf8").replace("    how:", "    hash: old\n    how:"),
    );
    const built = await docsBuild.handle(
      { audio: false, voice: "none", video: false },
      context(),
      run,
    );
    expect(built.files).toBe(10);
    expect(built.ok).toBe(false);
    expect(docsBuild.render(built, "text")).toContain("some pages are out of date");
    expect(docsBuild.exitCode(built)).toBe(0);
    expect(
      readFileSync(join(root, ".snagentic/site/processes/incident/configure/assign.html"), "utf8"),
    ).toContain("status-changed");
  });

  it("build --video renders each animation and says which it made", async () => {
    write("documentation/animations/asg/animation.json", '{"name":"asg","title":"Assignment"}');
    write(
      "documentation/animations/asg/scene.svg",
      '<svg viewBox="0 0 960 440"><g id="cam"></g></svg>',
    );
    write(
      "documentation/animations/asg/steps.json",
      '[{"t":"Saved","c":"Saved.","say":"It is saved."}]',
    );
    const built = await docsBuild.handle(
      { audio: false, voice: "none", video: true },
      context(),
      run,
    );
    expect(built.videos).toEqual(["asg"]);
    expect(docsBuild.render(built, "text")).toContain("videos: asg");
    expect(readFileSync(join(root, ".snagentic/site/animations/asg.mp4")).length).toBe(0);
  });

  it("build --video without a browser lists every animation it could not make", async () => {
    write("documentation/animations/asg/animation.json", '{"name":"asg","title":"Assignment"}');
    write(
      "documentation/animations/asg/scene.svg",
      '<svg viewBox="0 0 960 440"><g id="cam"></g></svg>',
    );
    write(
      "documentation/animations/asg/steps.json",
      '[{"t":"Saved","c":"Saved.","say":"It is saved."}]',
    );
    const base = context();
    const noBrowser: UseCaseContext = {
      ...base,
      documentation: (workspace) => {
        const docs = base.documentation(workspace);
        return {
          ...docs,
          media: {
            ...docs.media,
            video: { available: async () => false, render: async () => new Uint8Array(0) },
          },
        };
      },
    };
    const built = await docsBuild.handle(
      { audio: false, voice: "none", video: true },
      noBrowser,
      run,
    );
    expect(built.videosNotMade).toEqual([
      { animation: "asg", reason: "no Chrome or Chromium browser" },
    ]);
  });

  it("build --video names the animations it could not make", () => {
    const text = docsBuild.render(
      {
        root: "/s",
        files: 1,
        ok: true,
        evidence: [],
        problems: [],
        narrated: [],
        missingSounds: [],
        videos: [],
        videosNotMade: [{ animation: "asg", reason: "no Chrome or Chromium browser" }],
        videosPruned: 0,
      },
      "text",
    );
    expect(text).toContain("video not made: asg (no Chrome or Chromium browser)");
    expect(text).not.toContain("old recordings");
  });

  it("build says how many old recordings it removed from the video cache", () => {
    const text = docsBuild.render(
      {
        root: "/s",
        files: 1,
        ok: true,
        evidence: [],
        problems: [],
        narrated: ["asg"],
        missingSounds: [],
        videos: ["asg"],
        videosNotMade: [],
        videosPruned: 2,
      },
      "text",
    );
    expect(text).toContain("removed 2 old recordings from the video cache");
  });

  it("serve builds the site, then serves it on the requested port", async () => {
    const result = await docsServe.handle(
      { audio: false, voice: "none", video: false, port: 4999 },
      context(),
      run,
    );
    expect(served).toEqual({ port: 4999 });
    expect(result.url).toBe("http://127.0.0.1:4999/");
    expect(progress[0]).toContain("serving 10 files at http://127.0.0.1:4999/");
    expect(docsServe.render(result, "text")).toBe("stopped serving http://127.0.0.1:4999/");
    expect(docsServe.exitCode(result)).toBe(0);
  });

  it("build --voice gives each animation a narrated track, embedded and as an MP3", async () => {
    write(
      "documentation/animations/asg/animation.json",
      '{"name":"asg","mix":{"cues":[[0,0.5,"nope_1",-24]]}}',
    );
    write("documentation/animations/asg/scene.svg", '<svg><g id="cam"></g></svg>');
    write("documentation/animations/asg/steps.json", '[{"t":"A","c":"B","say":"Hello there."}]');
    const built = await docsBuild.handle(
      { audio: false, voice: "fake", video: false },
      context(),
      run,
    );
    expect(built.narrated).toEqual(["asg"]);
    expect(built.missingSounds).toEqual(["nope_1"]);
    expect(docsBuild.render(built, "text")).toContain("audio tracks: asg");
    expect(docsBuild.render(built, "text")).toContain("cue sounds not found (left out): nope_1");
    expect(readFileSync(join(root, ".snagentic/site/animations/asg.mp3"))).toEqual(
      Buffer.from([1, 2, 3]),
    );
    expect(readFileSync(join(root, ".snagentic/site/animations/asg.html"), "utf8")).toContain(
      'src="data:audio/mpeg;base64,AQID"',
    );
  });

  it("video records an animation into .snagentic/videos", async () => {
    write("documentation/animations/asg/animation.json", '{"name":"asg"}');
    write("documentation/animations/asg/scene.svg", '<svg><g id="cam"></g></svg>');
    write("documentation/animations/asg/steps.json", '[{"t":"A","c":"B","say":"Hello there."}]');
    const result = await docsVideo.handle(
      { animation: "asg", voice: "none", fps: 30 },
      context(),
      run,
    );
    expect(result.path).toBe("/videos/asg.mp4");
    expect(progress[0]).toContain("recording asg in real time");
    expect(docsVideo.render(result, "text")).toContain("wrote /videos/asg.mp4");
    expect(docsVideo.exitCode(result)).toBe(0);
  });
});
