import { describe, expect, it } from "bun:test";
import { runtimeOptionsRefusal } from "@snagentic/core";

describe("runtime options from the environment (SEC3-05)", () => {
  it("refuses to start when BUN_OPTIONS gives the runtime its own arguments", () => {
    const refusal = runtimeOptionsRefusal({ PATH: "/usr/bin", BUN_OPTIONS: "--smol" });
    expect(refusal).toMatchObject({
      code: "runtime-options-set",
      category: "not-permitted",
      message: "BUN_OPTIONS is set: snagentic runs only with the runtime options it was built with",
    });
    expect(refusal?.hint).toContain("unset BUN_OPTIONS");
  });

  it("never repeats the variable's value", () => {
    const refusal = runtimeOptionsRefusal({ BUN_OPTIONS: "--user-agent=token-123" });
    expect(`${refusal?.message} ${refusal?.hint}`).not.toContain("token-123");
  });

  it("starts when the variable is absent or empty", () => {
    expect(runtimeOptionsRefusal({ PATH: "/usr/bin" })).toBeNull();
    expect(runtimeOptionsRefusal({ BUN_OPTIONS: "" })).toBeNull();
    expect(runtimeOptionsRefusal({ BUN_OPTIONS: "  " })).toBeNull();
  });
});
