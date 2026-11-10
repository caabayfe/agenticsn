import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mediaTestsRun } from "../../packages/cli/test/support/media-tests";

// The tests that drive a real ffmpeg, Chrome or Piper run where those are installed, and a
// switch moves them to their own CI job (spec 014, R1).
describe("the media tests switch", () => {
  it("runs the media tests where the program is installed, by default", () => {
    expect(mediaTestsRun("ffmpeg", true, {})).toBe(true);
    expect(mediaTestsRun("ffmpeg", false, {})).toBe(false);
  });

  it("skips them when SNAGENTIC_TEST_MEDIA is skip, even with the program installed", () => {
    expect(mediaTestsRun("ffmpeg", true, { SNAGENTIC_TEST_MEDIA: "skip" })).toBe(false);
  });

  it("fails rather than skips when SNAGENTIC_TEST_MEDIA is require and the program is missing", () => {
    expect(mediaTestsRun("Chrome", true, { SNAGENTIC_TEST_MEDIA: "require" })).toBe(true);
    expect(() => mediaTestsRun("Chrome", false, { SNAGENTIC_TEST_MEDIA: "require" })).toThrow(
      /Chrome is required/,
    );
  });

  it("refuses an unknown value instead of guessing", () => {
    expect(() => mediaTestsRun("ffmpeg", true, { SNAGENTIC_TEST_MEDIA: "off" })).toThrow(
      /SNAGENTIC_TEST_MEDIA/,
    );
  });
});

describe("the coverage settings of the gating CI legs", () => {
  const root = join(import.meta.dir, "../..");
  const settings = (file: string) => {
    const parsed = Bun.TOML.parse(readFileSync(join(root, file), "utf8"));
    const test: Record<string, unknown> = { ...Object(Object(parsed)["test"]) };
    const { coveragePathIgnorePatterns, ...rest } = test;
    const ignored = Array.isArray(coveragePathIgnorePatterns)
      ? coveragePathIgnorePatterns.map(String)
      : [];
    return { ignored, rest };
  };

  it("match bunfig.toml except for the media adapters the media job measures", () => {
    const all = settings("bunfig.toml");
    const gate = settings("bunfig.no-media.toml");
    expect(gate.rest).toEqual(all.rest);
    const extra = gate.ignored.filter((pattern) => !all.ignored.includes(pattern));
    expect(gate.ignored).toEqual([...all.ignored, ...extra]);
    expect(extra.length).toBeGreaterThan(0);
    for (const path of extra) {
      expect(path).toStartWith("packages/cli/src/adapters/documentation/");
      expect(existsSync(join(root, path))).toBe(true);
    }
  });
});
