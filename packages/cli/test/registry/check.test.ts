import { afterEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { check } from "../../src/registry/check";
import { executeUseCase } from "../../src/registry/execute";
import { instanceWorkspace } from "../support/instance-workspace";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("check", () => {
  it("refuses protected files given as absolute paths, and exits 1", async () => {
    const ws = await instanceWorkspace({});
    cleanups.push(ws.cleanup);
    const { output, exitCode } = await executeUseCase(
      check,
      { paths: [join(ws.root, ".snagentic/pdi/sync-state.json")] },
      ws.context,
    );
    expect(output).toMatchObject({
      protected: [{ path: ".snagentic/pdi/sync-state.json" }],
      passed: false,
    });
    expect(exitCode).toBe(1);
    expect(check.render(output as never, "text")).toContain(
      "protected: .snagentic/pdi/sync-state.json: local state",
    );
  });

  it("refuses an edit to the mirror, and passes Fluent source", async () => {
    const ws = await instanceWorkspace({});
    cleanups.push(ws.cleanup);
    const mirror = "instances/pdi/metadata/global/sys_script/r--b1.yaml";
    const refused = await executeUseCase(check, { paths: [join(ws.root, mirror)] }, ws.context);
    expect(refused.output).toMatchObject({ protected: [{ path: mirror }], passed: false });
    const source = await executeUseCase(
      check,
      { paths: [join(ws.root, "source/global/src/fluent/r.now.ts")] },
      ws.context,
    );
    expect(source).toMatchObject({ output: { protected: [], passed: true }, exitCode: 0 });
    expect(check.render(source.output as never, "text")).toBe("check passed");
  });
});
