import { describe, expect, it } from "bun:test";
import { rulesFor, rulesForScript, scriptFieldsOf } from "@snagentic/core";

describe("script fields", () => {
  it("knows where each script of a class runs", () => {
    expect(scriptFieldsOf("sp_widget", {})).toEqual({
      script: "server",
      client_script: "portal_client",
      link: "portal_client",
    });
    expect(scriptFieldsOf("u_custom", {})).toEqual({});
  });

  it("runs a client UI action's script in the browser, unless it guards a server branch", () => {
    expect(scriptFieldsOf("sys_ui_action", { client: "true", script: "go();" })["script"]).toBe(
      "client",
    );
    expect(
      scriptFieldsOf("sys_ui_action", {
        client: "true",
        script: "if (typeof window == 'undefined') {}",
      })["script"],
    ).toBe("server");
    expect(scriptFieldsOf("sys_ui_action", {})["script"]).toBe("server");
  });

  it("applies a rule to a script only for its kind and classes", () => {
    const ids = (className: string, kind: "server" | "client") =>
      rulesForScript(className, kind).map((rule) => rule.id);
    expect(ids("sys_script_client", "client")).toContain("SN-UX-001");
    expect(ids("sys_ui_policy", "client")).not.toContain("SN-UX-001");
    expect(ids("sys_script_include", "server")).toContain("SN-MNT-005");
    expect(ids("sys_script", "server")).not.toContain("SN-MNT-005");
  });

  it("offers client rules for UI actions, whose scripts may run on either side", () => {
    expect(rulesFor(["sys_ui_action"]).map((rule) => rule.id)).toContain("SN-UX-003");
  });
});
