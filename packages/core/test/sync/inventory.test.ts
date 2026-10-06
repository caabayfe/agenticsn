import { describe, expect, it } from "bun:test";
import { INVENTORY, inventorySignature } from "@snagentic/core";

describe("the operational inventory", () => {
  it("lists plugins, store applications and domains, each with its key among its fields", () => {
    expect(INVENTORY.map((source) => source.file)).toEqual(["plugins", "store_apps", "domains"]);
    expect(INVENTORY.every((source) => source.fields.includes(source.key))).toBe(true);
  });

  it("reads store applications through sys_scope, the readable parent of sys_store_app", () => {
    expect(INVENTORY.find((source) => source.file === "store_apps")).toMatchObject({
      table: "sys_scope",
      base: "sys_class_name=sys_store_app",
    });
  });
});

describe("inventorySignature", () => {
  it("is the same whatever the order counts arrive in, and differs when one moves", () => {
    const a = inventorySignature(
      new Map([
        ["active", 972],
        ["inactive", 433],
      ]),
    );
    expect(a).toBe(
      inventorySignature(
        new Map([
          ["inactive", 433],
          ["active", 972],
        ]),
      ),
    );
    expect(a).not.toBe(
      inventorySignature(
        new Map([
          ["active", 973],
          ["inactive", 432],
        ]),
      ),
    );
  });
});
