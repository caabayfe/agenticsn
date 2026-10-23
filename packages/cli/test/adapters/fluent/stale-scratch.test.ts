import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sweepStaleScratch } from "../../../src/adapters/fluent/stale-scratch";

// Spec 012, B-21: adopt's scratch copy holds records read from the instance; a crash leaves it.
describe("sweeping stale scratch folders", () => {
  it("removes snagentic's instance-data scratch folders older than a day, and nothing else", () => {
    const root = mkdtempSync(join(tmpdir(), "sweep-root-"));
    const now = Date.now();
    const folder = (name: string, ageHours: number) => {
      const path = join(root, name);
      mkdirSync(path);
      writeFileSync(join(path, "record.xml"), "<x/>");
      const at = (now - ageHours * 3_600_000) / 1000;
      utimesSync(path, at, at);
      return path;
    };
    const stale = [
      folder("snagentic-adopt-a", 30),
      folder("snagentic-worker-b", 48),
      folder("snagentic-sdk-c", 25),
    ];
    const fresh = folder("snagentic-adopt-d", 1);
    const other = folder("someone-else-e", 72);
    const build = folder("snagentic-build-f", 72);
    expect(sweepStaleScratch(root, now).sort()).toEqual(stale.sort());
    for (const path of stale) expect(existsSync(path)).toBe(false);
    for (const path of [fresh, other, build]) expect(existsSync(path)).toBe(true);
  });

  it("does nothing when the folder can't be read", () => {
    expect(sweepStaleScratch(join(tmpdir(), "no-such-folder-for-sweep"))).toEqual([]);
  });
});
