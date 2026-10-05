import { describe, expect, it } from "bun:test";
import {
  checkLayout,
  GITIGNORE,
  InstanceName,
  instancePaths,
  LAYOUT_VERSION,
  manifestFor,
  WorkspaceLayoutError,
} from "@snagentic/core";

describe("workspace manifest", () => {
  it("creates a manifest for the current layout version", () => {
    expect(manifestFor("snagentic 1.0.0")).toEqual({
      layout: LAYOUT_VERSION,
      createdWith: "snagentic 1.0.0",
    });
  });

  it("accepts a manifest with the current layout", () => {
    expect(checkLayout({ layout: 1, createdWith: "snagentic 1.0.0" }).layout).toBe(1);
  });

  it("asks to upgrade snagentic for a newer layout", () => {
    expect(() => checkLayout({ layout: 2, createdWith: "x" })).toThrow(WorkspaceLayoutError);
    try {
      checkLayout({ layout: 2, createdWith: "x" });
    } catch (error) {
      expect((error as WorkspaceLayoutError).hint).toContain("upgrade snagentic");
    }
  });

  it.each([{ layout: 0 }, {}, null, "layout: 1", { layout: "1" }])(
    "asks to run migrate for an older or unreadable manifest %p",
    (manifest) => {
      try {
        checkLayout(manifest);
        throw new Error("expected a layout error");
      } catch (error) {
        expect(error).toBeInstanceOf(WorkspaceLayoutError);
        expect((error as WorkspaceLayoutError).hint).toContain("snagentic migrate");
      }
    },
  );
});

describe("workspace layout", () => {
  it("places every artifact of an instance under instances/<name>", () => {
    expect(instancePaths(InstanceName.parse("dev"))).toEqual({
      root: "instances/dev",
      profile: "instances/dev/instance.yaml",
      metadata: "instances/dev/metadata",
      updateSets: "instances/dev/update-sets",
      operational: "instances/dev/operational",
      localState: ".snagentic/dev",
      remoteBranch: "servicenow-remote/dev",
    });
  });

  it("keeps local state and secrets out of git", () => {
    expect(GITIGNORE).toContain(".snagentic/");
    expect(GITIGNORE).toContain(".env");
  });
});
