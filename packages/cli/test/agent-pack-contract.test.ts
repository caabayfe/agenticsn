import { describe, expect, it } from "bun:test";
import { INSTRUCTIONS, SKILLS, skillFiles } from "@snagentic/agent-packs";
import { z } from "zod";
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
