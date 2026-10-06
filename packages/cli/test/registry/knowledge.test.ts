import { afterEach, expect, describe as group, it } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { InstanceName } from "@snagentic/core";
import { runGitOrThrow } from "../../src/adapters/git/run-git";
import { toYaml } from "../../src/adapters/yaml/own-style";
import { advise } from "../../src/registry/advise";
import { describe } from "../../src/registry/describe";
import { executeUseCase } from "../../src/registry/execute";
import { find } from "../../src/registry/find";
import { instanceWorkspace } from "../support/instance-workspace";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const META = "instances/pdi/metadata/global";

async function workspace() {
  const ws = await instanceWorkspace({});
  cleanups.push(ws.cleanup);
  const write = async (path: string, content: string) => {
    await mkdir(join(ws.root, META, path, ".."), { recursive: true });
    await writeFile(join(ws.root, META, path), content);
  };
  const rec = (className: string, sysId: string, fields: Record<string, string>) =>
    toYaml({ _meta: { sys_class_name: className, sys_id: sysId, scope: "global" }, ...fields });
  await write(
    "sys_script/set-priority--b1.yaml",
    rec("sys_script", "b1", {
      name: "Set priority",
      collection: "incident",
      when: "before",
      order: "50",
    }),
  );
  await write("sys_script/set-priority--b1.script.js", "new Prioritizer().apply(current);\n");
  await write(
    "sys_script_include/prioritizer--s1.yaml",
    rec("sys_script_include", "s1", { name: "Prioritizer" }),
  );
  await write(
    "sys_script_include/prioritizer--s1.script.js",
    "var Prioritizer = Class.create();\n",
  );
  await runGitOrThrow(["add", "instances"], ws.root);
  await runGitOrThrow(
    ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "integrate"],
    ws.root,
  );
  await ws.context
    .syncState(ws.root, InstanceName.parse("pdi"))
    .writeCatalog({ parents: { incident: "task", task: null }, scopes: {}, typedFields: {} });
  return ws;
}

group("find and describe", () => {
  it("describe lists a table's behavior from the workspace, the instance defaulting to the only one", async () => {
    const { context, instance } = await workspace();
    const { output } = await executeUseCase(describe, { target: "incident" }, context);
    expect(output).toMatchObject({ instance: "pdi", kind: "table" });
    expect(
      (output["table"] as { behavior: { before: { name: string }[] } }).behavior.before[0]?.name,
    ).toBe("Set priority");
    expect(instance.queries).toEqual([]);
    expect(describe.render(output as never, "text")).toContain("50  business rule: Set priority");
  });

  it("describe tells who uses a script include", async () => {
    const { context } = await workspace();
    const { output } = await executeUseCase(
      describe,
      { target: "global/sys_script_include/prioritizer--s1.yaml" },
      context,
    );
    const text = describe.render(output as never, "text");
    expect(text).toContain(
      "used by sys_script: Set priority  global/sys_script/set-priority--b1.yaml:1",
    );
    expect(text).toContain("file: global/sys_script_include/prioritizer--s1.script.js");
  });

  it("find searches names and code, and sees local edits", async () => {
    const { context, root } = await workspace();
    expect(
      find.render(
        (await executeUseCase(find, { text: "priority" }, context)).output as never,
        "text",
      ),
    ).toContain("Set priority");
    await writeFile(
      join(root, META, "sys_script/set-priority--b1.script.js"),
      "gs.info('no more');\n",
    );
    const code = await executeUseCase(find, { text: "Prioritizer", code: true }, context);
    expect((code.output["records"] as { name: string }[]).map((r) => r.name)).toEqual([
      "Prioritizer",
    ]);
    const nothing = await executeUseCase(find, { text: "nonexistentthing" }, context);
    expect(find.render(nothing.output as never, "text")).toContain(
      'try: find {"text":"nonexistentthing","code":true}',
    );
  });

  it("asks which instance when the workspace has several", async () => {
    const { context, root } = await workspace();
    const pdi = await context.profiles.read(root, InstanceName.parse("pdi"));
    if (pdi === null) {
      throw new Error("the workspace has no pdi profile");
    }
    await context.profiles.write(root, { ...pdi, name: InstanceName.parse("dev2") });
    await expect(executeUseCase(find, { text: "x" }, context)).rejects.toMatchObject({
      code: "invalid-input",
      message: expect.stringContaining("dev2, pdi"),
    });
  });
});

group("find rendering", () => {
  it("shows code matches under their record, and says when there are more", () => {
    const text = find.render(
      {
        instance: "pdi",
        asOf: null,
        stale: true,
        total: 40,
        more: true,
        next: [],
        records: [
          {
            path: "global/sys_script/a--b1.yaml",
            name: "A",
            className: "sys_script",
            table: "incident",
            scope: "global",
            active: false,
            matches: [
              { file: "global/sys_script/a--b1.script.js", line: 3, text: "new Prioritizer()" },
            ],
          },
        ],
      },
      "text",
    );
    expect(text).toContain("(inactive) A");
    expect(text).toContain("    global/sys_script/a--b1.script.js:3  new Prioritizer()");
    expect(text).toContain("… 40 in all; narrow with --class, --table or more words");
  });
});

group("advise", () => {
  it("advises on a request about a table, least custom first, with the design record", async () => {
    const { context } = await workspace();
    const { output } = await executeUseCase(
      advise,
      { intent: "set the priority automatically", tables: ["incident"] },
      context,
    );
    expect(output["intents"]).toEqual([
      { id: "set-value", label: "fill in, default, calculate or copy a value" },
    ]);
    const text = advise.render(output as never, "text");
    expect(text).toContain("[likely] Dictionary default value or a template (configuration)");
    expect(text).toContain("already: 1 on incident (before)");
    expect(text).toContain("business rule: Set priority");
    expect(text).toContain("Design record:");
  });

  it("lists rules for the classes being built", async () => {
    const { context } = await workspace();
    const { output } = await executeUseCase(
      advise,
      { intent: "anything", phase: "build", classes: ["sys_script"] },
      context,
    );
    expect(advise.render(output as never, "text")).toContain("[SN-PERF-001][block]");
    expect(advise.render(output as never, "text")).toContain("request not recognised");
  });
});
