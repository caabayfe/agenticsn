import { describe, expect, it } from "bun:test";
import { VERSION } from "@snagentic/core";

describe("core package", () => {
  it("exposes its version as a semantic version string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });
});
