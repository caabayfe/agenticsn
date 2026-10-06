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
      { paths: [join(ws.root, ".snagentic/pdi/sync-state.json")], edited: false },
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

  it("renders findings with their fix, and a pass", () => {
    const text = check.render(
      {
        protected: [],
        findings: [
          {
            ruleId: "SN-MNT-001",
            severity: "warn",
            path: "a.js",
            line: 3,
            message: "m",
            remediation: "r",
          },
        ],
        passed: true,
      },
      "text",
    );
    expect(text).toBe("warn SN-MNT-001 a.js:3 m (fix: r)\ncheck passed");
  });
});
