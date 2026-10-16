import { describe, expect, it } from "bun:test";
import { protectedReason } from "@snagentic/core";

describe("protected paths", () => {
  it("protects local state, git, the mirror, the ledgers and workspace configuration", () => {
    for (const path of [
      ".snagentic/pdi/knowledge.sqlite",
      ".git/config",
      "instances/pdi/metadata/global/sys_ui_policy_action/x--1.yaml",
      "instances/pdi/metadata/global/sys_script/default-children-rule--1.script.js",
      "instances/pdi/metadata/x_acme/sys_ui_section/s--1.children.sys_ui_element.yaml",
      "source/x_acme/snagentic.ledger.yaml",
      "./instances/pdi/instance.yaml",
      "snagentic.yaml",
    ]) {
      expect(protectedReason(path)).not.toBeNull();
    }
    expect(protectedReason("instances/pdi/metadata/global/sys_script/r--1.yaml")).toContain(
      "snagentic adopt",
    );
  });

  it("lets Fluent source and the team's own files be edited", () => {
    for (const path of [
      "source/x_acme/src/fluent/rule.now.ts",
      "source/x_acme/src/fluent/rule.server.js",
      "source/global/src/fluent/generated/keys.ts",
      "AGENTS.md",
    ]) {
      expect(protectedReason(path)).toBeNull();
    }
  });

  it("protects the hooks, permission rules and waivers that guard the agent", () => {
    for (const path of [
      ".claude/settings.json",
      ".claude/settings.local.json",
      ".github/hooks/snagentic.json",
      "waivers.yaml",
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
