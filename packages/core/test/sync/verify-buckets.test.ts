import { describe, expect, it } from "bun:test";
import {
  childPrefixes,
  compareListing,
  hasPrefix,
  hiddenKey,
  hiddenUnder,
  isHexPrefixed,
  LIST_LIMIT,
  mergeHidden,
  mirroredRecord,
  verifyStep,
} from "@snagentic/core";

describe("mirroredRecord", () => {
  it("reads scope and sys_id from a record base, in or outside a domain", () => {
    expect(mirroredRecord("x_acme/sys_script/rule--0123")).toEqual({
      scope: "x_acme",
      sysId: "0123",
    });
    expect(mirroredRecord("domains/acme/global/sys_script/rule--0123")).toEqual({
      scope: "global",
      sysId: "0123",
    });
    expect(mirroredRecord("global/sys_ui_view/default-view--Default view")).toEqual({
      scope: "global",
      sysId: "Default view",
    });
  });

  it("ignores paths that are not record bases", () => {
    expect(mirroredRecord("v_plugin")).toBeNull();
    expect(mirroredRecord("global/sys_script/no-separator")).toBeNull();
  });
});

describe("prefixes", () => {
  it("splits a prefix into its 16 hex children", () => {
    expect(childPrefixes("a")).toHaveLength(16);
    expect(childPrefixes("a")[0]).toBe("a0");
    expect(childPrefixes("a")[15]).toBe("af");
  });

  it("matches prefixes without regard to case, as the instance does", () => {
    expect(hasPrefix("ABC123", "ab")).toBe(true);
    expect(hasPrefix("Default view", "d")).toBe(true);
    expect(hasPrefix("0abc", "1")).toBe(false);
  });

  it("tells legacy ids that no hex prefix covers", () => {
    expect(isHexPrefixed("0abc", 2)).toBe(true);
    expect(isHexPrefixed("Global view", 2)).toBe(false);
  });
});

describe("verifyStep", () => {
  it("stops where counts agree", () => {
    expect(verifyStep(10, 0, 10, "")).toBe("agree");
  });

  it("allows for rows the user could not list last time", () => {
    expect(verifyStep(12, 2, 10, "")).toBe("agree");
    expect(verifyStep(13, 2, 10, "")).toBe("list");
  });

  it("lists a small part and splits a large one", () => {
    expect(verifyStep(LIST_LIMIT, 0, 1, "")).toBe("list");
    expect(verifyStep(LIST_LIMIT + 1, 0, 1, "")).toBe("split");
  });

  it("lists once the prefix is as long as it may get", () => {
    expect(verifyStep(LIST_LIMIT * 10, 0, 1, "abcd")).toBe("list");
  });
});

describe("hidden counts", () => {
  const hidden = { "global|0": 3, "global|1a": 2, "x_acme|": 5 };

  it("adds up what is remembered under a part", () => {
    expect(hiddenUnder(hidden, "global", "")).toBe(5);
    expect(hiddenUnder(hidden, "global", "1")).toBe(2);
    expect(hiddenUnder(hidden, "x_acme", "")).toBe(5);
    expect(hiddenUnder(hidden, "x_acmf", "")).toBe(0);
  });

  it("replaces everything under a part listed again, and drops zeros", () => {
    expect(
      mergeHidden(hidden, { [hiddenKey("global", "")]: 4, [hiddenKey("x_acme", "")]: 0 }),
    ).toEqual({
      "global|": 4,
    });
  });
});

describe("compareListing", () => {
  it("finds records missing from the mirror and records gone from the instance", () => {
    const instance = new Map([
      ["a", "sys_script"],
      ["b", "sys_script"],
    ]);
    expect(compareListing(instance, ["b", "c"])).toEqual({
      missing: new Map([["a", "sys_script"]]),
      extra: ["c"],
    });
  });
});
