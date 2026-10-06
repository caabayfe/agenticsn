import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runGitOrThrow } from "../../src/adapters/git/run-git";
import { toYaml } from "../../src/adapters/yaml/own-style";
import { executeUseCase } from "../../src/registry/execute";
import { validate } from "../../src/registry/validate";
import { instanceWorkspace } from "../support/instance-workspace";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const META = "instances/pdi/metadata";
const RULE = "global/sys_script/set-priority--b1";

async function workspace() {
  const ws = await instanceWorkspace({});
  cleanups.push(ws.cleanup);
  const write = async (path: string, content: string) => {
    await mkdir(join(ws.root, META, path, ".."), { recursive: true });
    await writeFile(join(ws.root, META, path), content);
  };
  await write(
    `${RULE}.yaml`,
    toYaml({
      _meta: { sys_class_name: "sys_script", sys_id: "b1", scope: "global" },
      name: "Set priority",
      collection: "incident",
      when: "before",
      description: "Sets priority",
    }),
  );
  await write(`${RULE}.script.js`, "current.priority = 1;\ncurrent.update();\n");
  await runGitOrThrow(["add", "instances"], ws.root);
  await runGitOrThrow(
    ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "integrate"],
    ws.root,
  );
  return { ...ws, write };
}

describe("validate", () => {
  it("passes when nothing changed, without calling the instance", async () => {
    const { context, instance } = await workspace();
    const { output, exitCode } = await executeUseCase(validate, {}, context);
    expect(output).toMatchObject({ instance: "pdi", base: "HEAD", records: 0, passed: true });
    expect(exitCode).toBe(0);
    expect(instance.queries).toEqual([]);
    expect(validate.render(output as never, "text")).toBe("no changed records since HEAD");
  });

  it("reports only what an edit introduced, and exits 1 on a blocking finding", async () => {
    const { context, write } = await workspace();
    await write(`${RULE}.script.js`, "current.priority = 1;\ncurrent.update();\neval(code);\n");
    const { output, exitCode } = await executeUseCase(validate, {}, context);
    expect(output).toMatchObject({
      records: 1,
      passed: false,
      counts: { block: 1, warn: 0, info: 0 },
      findings: [{ ruleId: "SN-SEC-001", path: `${RULE}.script.js`, line: 3 }],
    });
    expect(exitCode).toBe(1);
    const text = validate.render(output as never, "text");
    expect(text).toContain(`block SN-SEC-001  ${RULE}.script.js:3`);
    expect(text).toContain("1 record(s) checked against HEAD: 1 block, 0 warn, 0 info");
  });

  it("checks given paths, from the workspace or the metadata folder, against any base", async () => {
    const { context } = await workspace();
    const { output } = await executeUseCase(
      validate,
      { paths: [`${META}/${RULE}.script.js`], base: "HEAD" },
      context,
    );
    expect(output).toMatchObject({ records: 1, passed: true, findings: [] });
  });

  it("lists what it did not check", () => {
    const text = validate.render(
      {
        instance: "pdi",
        base: "HEAD",
        records: 1,
        passed: true,
        counts: { block: 0, warn: 0, info: 0 },
        findings: [],
        notChecked: [{ path: "big.script.js", reason: "over 512000 bytes" }],
        rulesNotChecked: [],
      },
      "text",
    );
    expect(text).toContain("not checked: big.script.js (over 512000 bytes)");
  });
});
