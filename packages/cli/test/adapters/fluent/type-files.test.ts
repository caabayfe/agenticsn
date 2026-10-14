import { describe, expect, it } from "bun:test";
import { gzipSync } from "node:zlib";
import {
  collectTypeFiles,
  decodeTypeFiles,
  encodeTypeFiles,
} from "../../../src/adapters/fluent/type-files";

const CLI_PACKAGE = new URL("../../..", import.meta.url).pathname;

describe("Fluent type files", () => {
  const files = collectTypeFiles(CLI_PACKAGE);

  it("holds the SDK's declarations, glide's, and every .json, keyed with / on every platform", () => {
    expect(files.has("@servicenow/sdk/package.json")).toBe(true);
    expect(files.has("@servicenow/glide/package.json")).toBe(true);
    // Marks the built-in actions as a package of their own (flows test plan, A3).
    expect(files.has("@servicenow/sdk-core/now.config.json")).toBe(true);
    expect([...files.keys()].some((k) => k.includes("\\"))).toBe(false);
    expect([...files.keys()].some((k) => k.endsWith(".js") || k.endsWith(".map"))).toBe(false);
  });

  it("survives encoding and decoding unchanged", () => {
    expect(decodeTypeFiles(encodeTypeFiles(files))).toEqual(files);
  });

  it("refuses an embedded asset that is not a map of files", () => {
    expect(() => decodeTypeFiles(gzipSync("null"))).toThrow("not an object");
  });
});
