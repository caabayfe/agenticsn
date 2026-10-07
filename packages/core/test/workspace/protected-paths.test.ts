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

  it("protects the hooks and permission rules that guard the agent", () => {
    for (const path of [
      ".claude/settings.json",
      ".claude/settings.local.json",
      ".github/hooks/snagentic.json",
    ]) {
      expect(protectedReason(path)).not.toBeNull();
    }
    expect(protectedReason(".claude/skills/servicenow-build/SKILL.md")).toBeNull();
  });

  it("is not fooled by letter case or Windows separators", () => {
    for (const path of [
      ".SNAGENTIC/pdi/state.json",
      "Snagentic.yaml",
      ".Claude/Settings.json",
      "instances\\pdi\\instance.yaml",
      ".\\.snagentic\\pdi\\state.json",
    ]) {
      expect([path, protectedReason(path)]).not.toEqual([path, null]);
    }
  });
});
