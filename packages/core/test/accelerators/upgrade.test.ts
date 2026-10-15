import { describe, expect, it } from "bun:test";
import { carried } from "@snagentic/core";

describe("a pack upgrade never deletes (ADR-0026, M8)", () => {
  it("keeps the files the last add wrote that this version no longer has, and reports them once", () => {
    expect(
      carried({ written: ["a.yaml", "gone.yaml"], kept: ["older.yaml"] }, ["a.yaml", "new.yaml"]),
    ).toEqual({ keep: ["gone.yaml", "older.yaml"], removed: ["gone.yaml"] });
  });

  it("stops keeping a file a later version ships again", () => {
    expect(carried({ written: ["a.yaml"], kept: ["back.yaml"] }, ["a.yaml", "back.yaml"])).toEqual({
      keep: [],
      removed: [],
    });
  });

  it("keeps nothing on a first add", () => {
    expect(carried({ written: [], kept: [] }, ["a.yaml"])).toEqual({ keep: [], removed: [] });
  });
});
