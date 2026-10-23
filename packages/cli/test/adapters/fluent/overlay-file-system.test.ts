import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OverlayFileSystem } from "../../../src/adapters/fluent/overlay-file-system";

const files = new Map([
  ["@servicenow/sdk/package.json", '{ "version": "4.13.6" }'],
  ["@servicenow/sdk/dist/index.d.ts", "export {};"],
]);

function overlay(): { fs: OverlayFileSystem; root: string } {
  const root = mkdtempSync(join(tmpdir(), "overlay-"));
  return { fs: new OverlayFileSystem(root, files), root };
}

// A project folder with a sibling outside it, as a build copy sits in its scratch folder.
function confined(): { fs: OverlayFileSystem; root: string; outside: string } {
  const scratch = mkdtempSync(join(tmpdir(), "overlay-scratch-"));
  const root = join(scratch, "project");
  const outside = join(scratch, "victim");
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(outside, "keep.txt"), "keep");
  writeFileSync(join(scratch, ".prettierrc.mjs"), "export default {};");
  return { fs: new OverlayFileSystem(root, files), root, outside };
}

describe("overlay file system", () => {
  it("serves embedded files under the project's node_modules as text or bytes", () => {
    const { fs, root } = overlay();
    const path = join(root, "node_modules", "@servicenow", "sdk", "package.json");
    expect(fs.readFileSync(path, { encoding: "utf-8" })).toBe('{ "version": "4.13.6" }');
    expect(fs.readFileSync(path).toString("utf8")).toBe('{ "version": "4.13.6" }');
    const stats = fs.statSync(path);
    expect(stats.isFile()).toBe(true);
    expect([
      stats.isCharacterDevice(),
      stats.isBlockDevice(),
      stats.isSocket(),
      stats.isFIFO(),
    ]).toEqual([false, false, false, false]);
    expect(fs.lstatSync(path).isSymbolicLink()).toBe(false);
    expect(fs.realpathSync(path)).toBe(path);
    expect(() => fs.accessSync(path)).not.toThrow();
  });

  it("lists embedded directories, with or without file types", () => {
    const { fs, root } = overlay();
    const modules = join(root, "node_modules");
    expect(fs.readdirSync(modules)).toEqual(["@servicenow"]);
    const entries = fs.readdirSync(join(modules, "@servicenow", "sdk"), { withFileTypes: true });
    expect(entries.map((e) => [e.name, e.isDirectory()])).toEqual([
      ["package.json", false],
      ["dist", true],
    ]);
    expect(fs.statSync(modules).isDirectory()).toBe(true);
  });

  it("answers ENOENT for paths under node_modules it does not hold", () => {
    const { fs, root } = overlay();
    const missing = join(root, "node_modules", "rollup", "package.json");
    for (const call of [
      () => fs.statSync(missing),
      () => fs.accessSync(missing),
      () => fs.realpathSync(missing),
      () => fs.readFileSync(missing),
      () => fs.readdirSync(join(root, "node_modules", "rollup")),
    ]) {
      expect(call).toThrow(expect.objectContaining({ code: "ENOENT" }));
    }
  });

  it("passes every other path to the real file system", () => {
    const { fs, root } = overlay();
    fs.mkdirSync(join(root, "src", "fluent"), { recursive: true });
    fs.writeFileSync(join(root, "src", "fluent", "a.now.ts"), "export {};");
    fs.copyFileSync(join(root, "src", "fluent", "a.now.ts"), join(root, "b.now.ts"));
    fs.renameSync(join(root, "b.now.ts"), join(root, "c.now.ts"));
    expect(readFileSync(join(root, "c.now.ts"), "utf8")).toBe("export {};");
    expect(fs.readFileSync(join(root, "c.now.ts"), { encoding: "utf-8" })).toBe("export {};");
    expect(fs.readFileSync(join(root, "c.now.ts")).length).toBe(10);
    expect(fs.readdirSync(join(root, "src"))).toEqual(["fluent"]);
    expect(fs.readdirSync(join(root, "src"), { withFileTypes: true })[0]?.isDirectory()).toBe(true);
    expect(fs.statSync(root).isDirectory()).toBe(true);
    expect(fs.lstatSync(join(root, "c.now.ts")).isFile()).toBe(true);
    expect(() => fs.accessSync(join(root, "c.now.ts"))).not.toThrow();
    expect(fs.realpathSync(root).endsWith(root.split("/").pop() ?? "")).toBe(true);
    fs.rmSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "d.txt"), "x");
    expect(fs.readdirSync(root).sort()).toEqual(["c.now.ts", "d.txt"]);
  });

  // A project's config can name output folders, and the SDK searches parent folders for
  // configs it imports: neither may reach past the project (spec 012, B-01 and B-03).
  it("shows nothing outside the project", () => {
    const { fs, root, outside } = confined();
    const config = join(root, "..", ".prettierrc.mjs");
    for (const call of [
      () => fs.statSync(config),
      () => fs.lstatSync(config),
      () => fs.accessSync(config),
      () => fs.realpathSync(config),
      () => fs.readFileSync(config),
      () => fs.readdirSync(outside),
      () => fs.readdirSync(join(root, ".."), { withFileTypes: true }),
    ]) {
      expect(call).toThrow(expect.objectContaining({ code: "ENOENT" }));
    }
  });

  it("refuses to remove, write, rename or copy outside the project", () => {
    const { fs, root, outside } = confined();
    writeFileSync(join(root, "a.txt"), "a");
    for (const call of [
      () => fs.rmSync(outside, { recursive: true, force: true }),
      () => fs.rmSync(join(root, "..", "victim"), { recursive: true, force: true }),
      () => fs.writeFileSync(join(outside, "planted.txt"), "x"),
      () => fs.mkdirSync(join(outside, "made"), { recursive: true }),
      () => fs.renameSync(join(root, "a.txt"), join(outside, "a.txt")),
      () => fs.renameSync(join(outside, "keep.txt"), join(root, "keep.txt")),
      () => fs.copyFileSync(join(root, "a.txt"), join(outside, "a.txt")),
      () => fs.copyFileSync(join(outside, "keep.txt"), join(root, "keep.txt")),
    ]) {
      expect(call).toThrow(expect.objectContaining({ code: "EPERM" }));
    }
    expect(readFileSync(join(outside, "keep.txt"), "utf8")).toBe("keep");
    expect(existsSync(join(outside, "planted.txt"))).toBe(false);
    expect(existsSync(join(root, "a.txt"))).toBe(true);
  });
});
