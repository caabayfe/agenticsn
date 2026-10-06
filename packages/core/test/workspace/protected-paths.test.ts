import { describe, expect, it } from "bun:test";
import { protectedReason } from "@snagentic/core";

describe("protected paths", () => {
  it("protects local state, git, child rows and workspace configuration", () => {
    for (const path of [
      ".snagentic/pdi/knowledge.sqlite",
      ".git/config",
      "instances/pdi/metadata/global/sys_ui_form/form--1.children.sys_ui_form_section.yaml",
      "./instances/pdi/instance.yaml",
      "snagentic.yaml",
    ]) {
      expect(protectedReason(path)).not.toBeNull();
    }
  });

  it("lets records, scripts and the team's own files be edited", () => {
    for (const path of [
      "instances/pdi/metadata/global/sys_ui_policy_action/x--1.yaml",
      "instances/pdi/metadata/global/sys_script/default-children-rule--1.script.js",
      "AGENTS.md",
      "waivers.yaml",
    ]) {
      expect(protectedReason(path)).toBeNull();
    }
  });
});
