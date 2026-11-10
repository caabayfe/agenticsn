import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { bunVersionMismatch, parseBunVersionFile } from "../../scripts/check-bun-version";

const ROOT = join(import.meta.dir, "../..");

describe("Bun version check", () => {
  it("accepts the Bun version the repository expects", () => {
    expect(bunVersionMismatch("1.4.4", "1.4.4")).toBeNull();
  });

  it("explains how to align a different Bun version", () => {
    const message = bunVersionMismatch("1.4.4", "1.4.2");
    expect(message).toContain("1.4.2");
    expect(message).toContain("1.4.4");
    expect(message).toContain(".bun-version");
    expect(message).toContain("bash -s bun-v1.4.4");
  });

  it("reads one exact version from .bun-version", () => {
    expect(parseBunVersionFile("1.4.4\n")).toBe("1.4.4");
  });

  it("refuses a .bun-version that is not one exact version", () => {
    expect(() => parseBunVersionFile("")).toThrow(/exact version/);
    expect(() => parseBunVersionFile("1.4")).toThrow(/exact version/);
    expect(() => parseBunVersionFile("latest")).toThrow(/exact version/);
  });

  it("is the single source of truth for every workflow that installs Bun", async () => {
    const workflows = await Array.fromAsync(
      new Bun.Glob(".github/workflows/*.yml").scan({ cwd: ROOT }),
    );
    for (const workflow of workflows) {
      const text = await Bun.file(join(ROOT, workflow)).text();
      if (!text.includes("oven-sh/setup-bun")) {
        continue;
      }
      expect({ workflow, pinsVersion: /bun-version:\s/.test(text) }).toEqual({
        workflow,
        pinsVersion: false,
      });
      expect({ workflow, readsFile: text.includes("bun-version-file: .bun-version") }).toEqual({
        workflow,
        readsFile: true,
      });
    }
    expect(workflows.length).toBeGreaterThan(0);
  });
});
