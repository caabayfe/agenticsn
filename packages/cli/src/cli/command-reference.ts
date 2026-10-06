import { z } from "zod";
import { mcpToolName, qualifiedName, type UseCase } from "../registry/use-case";
import { argumentSyntax, optionsFor } from "./zod-options";

// docs/reference/commands.md, generated from the registry (plan M7): the CLI commands with
// their arguments and options exactly as the CLI builds them, and the MCP tools.

function optionLine(option: ReturnType<typeof optionsFor>[number]): string {
  const extras = [
    option.defaultValue === undefined ? "" : `default: ${String(option.defaultValue)}`,
    option.argChoices === undefined ? "" : `one of: ${option.argChoices.join(", ")}`,
  ].filter(Boolean);
  return `- \`${option.flags}\`: ${option.description ?? ""}${extras.length > 0 ? ` (${extras.join("; ")})` : ""}`;
}

function changes(useCase: UseCase): string {
  if (useCase.flags.readOnly) {
    return "Changes the instance: no.";
  }
  return useCase.flags.requiresDevelopmentInstance
    ? "Changes the instance: **yes, development instances only**."
    : "Changes the instance: no (writes only to the workspace).";
}

function command(useCase: UseCase): string {
  const positional = useCase.arguments ?? [];
  const usage = [
    "snagentic",
    qualifiedName(useCase),
    ...positional.map((key) => argumentSyntax(useCase.input, key)),
    "[options]",
  ];
  const options = optionsFor(useCase.input, positional).map(optionLine);
  return [
    `### \`${qualifiedName(useCase)}\``,
    "",
    "```",
    usage.join(" "),
    "```",
    "",
    useCase.description,
    "",
    `${changes(useCase)} MCP tool: ${useCase.mcp ? `\`${mcpToolName(useCase)}\`` : "none"}.`,
    "",
    ...(options.length > 0 ? ["Options:", "", ...options, ""] : []),
    "All commands also take `--format agent|json|text` and `--workspace <path>`.",
    "",
  ].join("\n");
}

function fieldLines(useCase: UseCase): string[] {
  const schema = z.toJSONSchema(useCase.input, { io: "input" }) as {
    properties?: Record<string, { description?: string; enum?: unknown[]; type?: string }>;
    required?: string[];
  };
  return Object.entries(schema.properties ?? {}).map(([name, field]) => {
    const kind = field.enum === undefined ? (field.type ?? "value") : field.enum.join(" | ");
    const required = schema.required?.includes(name) ? "required" : "optional";
    return `  - \`${name}\` (${kind}, ${required})${field.description === undefined ? "" : `: ${field.description}`}`;
  });
}

function tool(useCase: UseCase): string[] {
  const annotation = useCase.flags.destructive ? " Destructive: hosts ask before running it." : "";
  return [
    `- \`${mcpToolName(useCase)}\`: ${useCase.description}${annotation}`,
    ...fieldLines(useCase),
  ];
}

export function commandReference(useCases: readonly UseCase[]): string {
  const commands = useCases.filter((useCase) => useCase.cli !== false);
  const tools = useCases.filter((useCase) => useCase.mcp);
  return [
    "# Command reference",
    "",
    "Generated from the use-case registry; do not edit. Regenerate with `bun run docs`.",
    "",
    "## Commands",
    "",
    ...commands.map(command),
    "## MCP tools",
    "",
    "`snagentic mcp` serves these tools over stdio. Tools that change an instance are only offered",
    "when the workspace has a development instance, and can only name those (ADR-0012).",
    "",
    ...tools.flatMap(tool),
    "",
  ].join("\n");
}
