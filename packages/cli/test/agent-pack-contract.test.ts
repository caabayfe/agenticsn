import { describe, expect, it } from "bun:test";
import {
  CLAUDE_SETTINGS,
  INSTRUCTIONS,
  SHELL_DENY,
  SKILLS,
  skillFiles,
} from "@snagentic/agent-packs";
import { z } from "zod";
import { CLAUDE_HOOK_EVENTS } from "../src/hooks/claude-hooks";
import { USE_CASES } from "../src/registry/registry";
import { mcpToolName } from "../src/registry/use-case";

// Every field name and enum value a schema can produce or accept.
function namesIn(schema: z.core.$ZodType, names: Set<string>): void {
  if (schema instanceof z.ZodObject) {
    for (const [key, field] of Object.entries(schema.shape)) {
      names.add(key);
      namesIn(field, names);
    }
  } else if (schema instanceof z.ZodArray) {
    namesIn(schema.element, names);
  } else if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodReadonly
  ) {
    namesIn(schema.unwrap(), names);
  } else if (schema instanceof z.ZodUnion) {
    for (const option of schema.options) {
      namesIn(option, names);
    }
  } else if (schema instanceof z.ZodRecord) {
    namesIn(schema.valueType, names);
  } else if (schema instanceof z.ZodEnum) {
    for (const value of schema.options) {
      names.add(String(value));
    }
  }
}

const tools = USE_CASES.filter((useCase) => useCase.mcp);
const known = new Set<string>(["snagentic", ...SKILLS.map((skill) => skill.name)]);
for (const useCase of tools) {
  known.add(mcpToolName(useCase));
  namesIn(useCase.input, known);
  namesIn(useCase.output, known);
}

const codeSpans = (text: string) => [...text.matchAll(/`([^`\n]+)`/g)].map(([, span = ""]) => span);

describe("the agent pack's contract with the tools", () => {
  const texts = [
    { source: "instructions", text: INSTRUCTIONS },
    ...skillFiles("test").map((file) => ({ source: file.path, text: file.content })),
  ];

  it.each(texts)("$source names only existing tools, fields and values", ({ text }) => {
    const unknown = codeSpans(text).filter((span) => !known.has(span));
    expect(unknown).toEqual([]);
  });

  it("routes every skill through the tools", () => {
    const toolNames = new Set(tools.map(mcpToolName));
    for (const skill of SKILLS) {
      const named = skill.steps.flatMap(codeSpans).filter((span) => toolNames.has(span));
      expect({ skill: skill.name, tools: named.length > 0 }).toEqual({
        skill: skill.name,
        tools: true,
      });
    }
  });
});

describe("the Claude Code settings' contract with snagentic", () => {
  it("runs only hook events snagentic handles", () => {
    const commands = Object.values(CLAUDE_SETTINGS.hooks).flatMap((entries) =>
      entries.flatMap((entry) => entry.hooks.map((hook) => hook.command)),
    );
    expect(commands.map((command) => command.replace("snagentic hook claude ", "")).sort()).toEqual(
      [...CLAUDE_HOOK_EVENTS].sort(),
    );
  });

  it("names only existing tools in its permission rules", () => {
    const toolNames = new Set(USE_CASES.filter((u) => u.mcp).map(mcpToolName));
    const rules = [...CLAUDE_SETTINGS.permissions.ask, ...CLAUDE_SETTINGS.permissions.deny];
    for (const rule of rules.filter((r) => r.startsWith("mcp__snagentic__"))) {
      expect(toolNames.has(rule.replace("mcp__snagentic__", ""))).toBe(true);
    }
  });

  it("refuses in the shell hook every command its Bash deny rules name, for hosts that ignore them", () => {
    const commands = CLAUDE_SETTINGS.permissions.deny
      .filter((rule) => rule.startsWith("Bash("))
      .map((rule) => rule.slice("Bash(".length, -":*)".length));
    expect(commands).toContain("security find-generic-password");
    for (const command of commands) {
      const refused = SHELL_DENY.some((rule) => rule.pattern.test(`${command} x`));
      expect([command, refused]).toEqual([command, true]);
    }
  });
});
