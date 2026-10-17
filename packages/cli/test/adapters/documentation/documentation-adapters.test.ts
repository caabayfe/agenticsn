import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bunMarkdown } from "../../../src/adapters/documentation/bun-markdown";
import { FsDocumentationSources } from "../../../src/adapters/documentation/fs-documentation-sources";
import { FsMirrorRecords } from "../../../src/adapters/documentation/fs-mirror-records";
import { FsSiteOutput } from "../../../src/adapters/documentation/fs-site-output";
import { resolveSitePath, serveSite } from "../../../src/adapters/documentation/static-site-server";

let root: string;

function write(path: string, content: string) {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "snagentic-docs-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const PAGE = `---
# The technical page of the assignment capability.
title: Assignment configuration
reviewed: 2026-10-17
evidence:
  E01:
    record: sys_script/0c1345dd0783f01028ef0a701ad300fa
    how: read the script
    result: sets the group
---
## Rules

The rule sets the group. [E01]
`;

describe("documentation sources on disk", () => {
  it("reads site.yaml, the processes, their pages and the animations", async () => {
    write("documentation/site.yaml", "title: Docs\ninstance: pdi2\n");
    write("documentation/processes/incident/process.yaml", "title: Incident management\n");
    write("documentation/processes/incident/configure/assign.md", PAGE);
    write("documentation/animations/asg/animation.json", '{"name":"asg"}');
    write("documentation/animations/asg/scene.svg", '<svg><g id="cam"></g></svg>');
    write("documentation/animations/asg/steps.json", '[{"t":"A","c":"B","say":"C"}]');
    const sources = new FsDocumentationSources(root);
    expect(await sources.site()).toEqual({ title: "Docs", instance: "pdi2" });
    expect(await sources.processes()).toEqual([
      { path: "processes/incident/process.yaml", process: { title: "Incident management" } },
    ]);
    const [page] = await sources.pages();
    expect(page?.path).toBe("processes/incident/configure/assign.md");
    expect(page?.body).toBe("## Rules\n\nThe rule sets the group. [E01]\n");
    const [scene] = await sources.scenes();
    expect(scene).toMatchObject({ path: "animations/asg", css: null, steps: [{ t: "A" }] });
  });

  it("names the file and the reason when a page's front matter or an animation is not valid", async () => {
    write(
      "documentation/processes/incident/use/report.md",
      '---\ntitle: Report\nevidence:\n  E01:\n    result: "quoted" then more\n---\nBody\n',
    );
    const sources = new FsDocumentationSources(root);
    await expect(sources.pages()).rejects.toThrow(
      /processes\/incident\/use\/report\.md: is not valid YAML/,
    );
    write("documentation/animations/asg/animation.json", "{ not json");
    await expect(sources.scenes()).rejects.toThrow(
      /animations\/asg\/animation\.json: is not valid JSON/,
    );
  });

  it("has no site when documentation/site.yaml is absent", async () => {
    expect(await new FsDocumentationSources(root).site()).toBeNull();
  });

  it("pins hashes in the front matter and keeps comments, order and the body as written", async () => {
    write("documentation/processes/incident/configure/assign.md", PAGE);
    await new FsDocumentationSources(root).pinHashes(
      "processes/incident/configure/assign.md",
      new Map([
        ["E01", "abc123"],
        ["E09", "not listed"],
      ]),
    );
    const after = readFileSync(
      join(root, "documentation/processes/incident/configure/assign.md"),
      "utf8",
    );
    expect(after).toBe(
      PAGE.replace(
        "    result: sets the group\n",
        "    result: sets the group\n    hash: abc123\n",
      ),
    );
  });
});

describe("mirror records on disk", () => {
  const BASE =
    "instances/pdi2/metadata/global/sys_script/set-group--0c1345dd0783f01028ef0a701ad300fa";

  it("reads a record's hash and fields, long fields and children from their own files", async () => {
    write(`${BASE}.yaml`, "_meta:\n  hash: 3d9d\n  sys_id: 0c13\nname: Set group\nwhen: before\n");
    write(`${BASE}.script.js`, "current.assignment_group = g;\n");
    write(`${BASE}.children.sys_x.yaml`, "rows: []\n");
    const mirror = new FsMirrorRecords(join(root, "instances/pdi2/metadata"), async () => "c0ffee");
    const record = await mirror.read("sys_script", "0c1345dd0783f01028ef0a701ad300fa");
    expect(record).toEqual({
      hash: "3d9d",
      fields: { name: "Set group", when: "before", script: "current.assignment_group = g;\n" },
      children: { sys_x: "rows: []\n" },
    });
    expect(await mirror.head()).toBe("c0ffee");
  });

  it("lists a table's records from their own files, with who changed them last", async () => {
    write(
      `${BASE}.yaml`,
      "_meta:\n  hash: 3d9d\n  sys_updated_by: admin\n  sys_updated_on: 2026-05-01 10:00:00\nname: Set group\ncollection: incident\n",
    );
    write(`${BASE}.script.js`, "current.assignment_group = g;\n");
    write(`${BASE}.children.sys_x.yaml`, "rows: []\n");
    write("instances/pdi2/metadata/global/sys_script/notes.txt", "not a record");
    const mirror = new FsMirrorRecords(join(root, "instances/pdi2/metadata"), async () => null);
    const signal = new AbortController().signal;
    expect(await mirror.list("sys_script", signal)).toEqual([
      {
        sysId: "0c1345dd0783f01028ef0a701ad300fa",
        fields: { name: "Set group", collection: "incident" },
        updatedBy: "admin",
        updatedOn: "2026-05-01 10:00:00",
      },
    ]);
    expect(
      await new FsMirrorRecords(join(root, "missing"), async () => null).list("sys_script", signal),
    ).toEqual([]);
  });

  it("finds nothing for a record that is not mirrored", async () => {
    const mirror = new FsMirrorRecords(join(root, "missing"), async () => null);
    expect(await mirror.read("sys_script", "0c1345dd0783f01028ef0a701ad300fa")).toBeNull();
  });
});

describe("markdown", () => {
  it("renders tables and passes the page model's HTML through", () => {
    const html = bunMarkdown.html('| a |\n|---|\n| 1 |\n\n<span class="label">NEW</span>');
    expect(html).toContain("<td>1</td>");
    expect(html).toContain('<span class="label">NEW</span>');
  });
});

describe("site output and server", () => {
  it("replaces the previous build", async () => {
    const output = new FsSiteOutput(join(root, "site"));
    await output.replace([{ path: "old.html", content: "old" }]);
    await output.replace([{ path: "pages/a.html", content: "new" }]);
    expect(readFileSync(join(root, "site/pages/a.html"), "utf8")).toBe("new");
    expect(() => readFileSync(join(root, "site/old.html"))).toThrow();
  });

  it("serves only files inside the site", () => {
    write("site/index.html", "home");
    write("secret.txt", "no");
    const site = join(root, "site");
    expect(resolveSitePath(site, "/")).toBe(join(site, "index.html"));
    expect(resolveSitePath(site, "/../secret.txt")).toBeNull();
    expect(resolveSitePath(site, "/%2e%2e/secret.txt")).toBeNull();
    expect(resolveSitePath(site, "/nothing.html")).toBeNull();
  });

  it("serves the site on 127.0.0.1 until cancelled", async () => {
    write("site/index.html", "<h1>home</h1>");
    const stop = new AbortController();
    let url = "";
    const serving = serveSite(join(root, "site"), 0, stop.signal, (address) => {
      url = address;
    });
    await Bun.sleep(20);
    expect(url).toStartWith("http://127.0.0.1:");
    const response = await fetch(url);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toBe("<h1>home</h1>");
    stop.abort();
    await serving;
  });
});
