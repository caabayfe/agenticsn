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
import { docsCheck } from "../../src/registry/docs-check";
import { docsPin } from "../../src/registry/docs-pin";
import { docsServe } from "../../src/registry/docs-serve";
import type { UseCaseContext } from "../../src/registry/use-case";
import { FAKE_CONTEXT } from "../support/fakes";

const RULE = "0c1345dd0783f01028ef0a701ad300fa";
const RECORD = `instances/pdi2/metadata/global/sys_script/set-group--${RULE}.yaml`;
const PAGE = "documentation/processes/incident/assign.technical.md";

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
  it("check reports unpinned evidence and passes; pin records the hash; a mirror change then fails", async () => {
    const first = await docsCheck.handle({}, context(), run);
    expect(first.ok).toBe(true);
    expect(docsCheck.exitCode(first)).toBe(0);
    expect(docsCheck.render(first, "text")).toContain(
      "unpinned  processes/incident/assign.technical.md E01",
    );

    const pinned = await docsPin.handle({}, context(), run);
    expect(pinned.pinned.map((item) => item.id)).toEqual(["E01"]);
    expect(docsPin.exitCode(pinned)).toBe(0);
    expect(docsPin.render(pinned, "text")).toContain(
      "pinned 1 evidence\n  processes/incident/assign.technical.md E01",
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
    const built = await docsBuild.handle({ audio: false, voice: "none" }, context(), run);
    expect(built.files).toBe(4);
    expect(built.ok).toBe(false);
    expect(docsBuild.render(built, "text")).toContain("some pages are out of date");
    expect(docsBuild.exitCode(built)).toBe(0);
    expect(
      readFileSync(join(root, ".snagentic/site/processes/incident/assign.technical.html"), "utf8"),
    ).toContain("status-changed");
  });

  it("serve builds the site, then serves it on the requested port", async () => {
    const result = await docsServe.handle(
      { audio: false, voice: "none", port: 4999 },
      context(),
      run,
    );
    expect(served).toEqual({ port: 4999 });
    expect(result.url).toBe("http://127.0.0.1:4999/");
    expect(progress[0]).toContain("serving 4 files at http://127.0.0.1:4999/");
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
    const built = await docsBuild.handle({ audio: false, voice: "fake" }, context(), run);
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
});
