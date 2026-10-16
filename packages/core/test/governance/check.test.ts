import { describe, expect, it } from "bun:test";
import { checkFiles } from "@snagentic/core";

describe("checkFiles", () => {
  it("reports each protected file with why, and passes the rest", () => {
    const result = checkFiles({
      paths: [
        "instances/pdi/metadata/global/sys_script/r--1.yaml",
        "source/global/src/fluent/r.now.ts",
      ],
    });
    expect(result.passed).toBe(false);
    expect(result.protected).toEqual([
      {
        path: "instances/pdi/metadata/global/sys_script/r--1.yaml",
        reason: expect.stringContaining("written only by pull"),
      },
    ]);
    expect(checkFiles({ paths: ["source/global/src/fluent/r.now.ts"] })).toEqual({
      protected: [],
      passed: true,
    });
  });
});
