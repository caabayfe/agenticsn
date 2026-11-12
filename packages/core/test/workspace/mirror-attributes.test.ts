import { describe, expect, it } from "bun:test";
import {
  checkMirrorAttributes,
  hasMirrorAttributes,
  MIRROR_ATTRIBUTES_RULE,
  type WorkspaceFiles,
  withMirrorAttributes,
} from "@snagentic/core";

function filesWith(gitattributes: string | null): Pick<WorkspaceFiles, "read"> {
  return { read: async (path) => (path === "/w/.gitattributes" ? gitattributes : null) };
}

describe("the mirror's .gitattributes rule (spec 014, 1b-L)", () => {
  it("unsets text conversion for every file of the mirror", () => {
    expect(MIRROR_ATTRIBUTES_RULE).toBe("instances/** -text");
    expect(withMirrorAttributes(null)).toEndWith("\ninstances/** -text\n");
    expect(hasMirrorAttributes(withMirrorAttributes(null))).toBe(true);
  });

  it("appends the rule to a .gitattributes that lacks it, keeping the user's lines", () => {
    const merged = withMirrorAttributes("*.png binary\n*.sh text eol=lf");
    expect(merged.startsWith("*.png binary\n*.sh text eol=lf\n")).toBe(true);
    expect(merged).toEndWith("instances/** -text\n");
  });

  it("keeps a CRLF .gitattributes in CRLF", () => {
    const merged = withMirrorAttributes("*.png binary\r\n");
    expect(merged.startsWith("*.png binary\r\n")).toBe(true);
    expect(merged).toEndWith("\r\ninstances/** -text\r\n");
    expect(merged.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("never adds the rule twice", () => {
    const once = withMirrorAttributes("*.png binary\n");
    expect(withMirrorAttributes(once)).toBe(once);
    expect(withMirrorAttributes("/instances/**   binary\n")).toBe("/instances/**   binary\n");
  });

  it("reads git's last matching line: a later rule turning text back on needs the rule again", () => {
    expect(hasMirrorAttributes("instances/** -text\ninstances/** text\n")).toBe(false);
    expect(hasMirrorAttributes("# instances/** -text\n")).toBe(false);
    expect(hasMirrorAttributes("instances/*.js -text\n")).toBe(false);
  });
});

describe("doctor's mirror-line-endings check", () => {
  it("is ok when the workspace's .gitattributes has the rule", async () => {
    const check = await checkMirrorAttributes(filesWith(withMirrorAttributes(null)), "/w");
    expect(check).toMatchObject({ name: "mirror-line-endings", status: "ok", hint: null });
  });

  it("warns when the rule is missing, with how to add it and re-check the mirror out", async () => {
    for (const gitattributes of [null, "*.png binary\n"]) {
      const check = await checkMirrorAttributes(filesWith(gitattributes), "/w");
      expect(check.status).toBe("warn");
      expect(check.hint).toContain('add the line "instances/** -text"');
      expect(check.hint).toContain(
        "git rm -r --cached -q instances && git checkout HEAD -- instances",
      );
    }
  });
});
