import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The Windows CI leg leaves out the files in tests/windows-known-failures.txt (spec 014, R1).
// A renamed or deleted file must leave the list too, or the list stops meaning anything.
describe("the Windows known failures list", () => {
  const root = join(import.meta.dir, "../..");
  const listed = readFileSync(join(root, "tests/windows-known-failures.txt"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

  it("names only test files that exist, once each", () => {
    expect(
      listed.filter((path) => !path.endsWith(".test.ts") || !existsSync(join(root, path))),
    ).toEqual([]);
    expect(new Set(listed).size).toBe(listed.length);
  });
});
