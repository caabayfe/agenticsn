import { describe, expect, it } from "bun:test";
import { versionLine } from "@snagentic/cli";
import { VERSION } from "@snagentic/core";

describe("cli version line", () => {
  it("prints the product name followed by the core version", () => {
    expect(versionLine()).toBe(`snagentic ${VERSION}`);
  });
});
