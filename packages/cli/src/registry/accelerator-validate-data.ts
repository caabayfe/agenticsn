import { validateData } from "@snagentic/core";
import { z } from "zod";
import { DataSourceInput, dataSourceOf, SelectionInput, selectionOf } from "./accelerator-schemas";
import { defineUseCase } from "./use-case";

export const acceleratorValidateData = defineUseCase({
  group: "accelerator",
  name: "validate-data",
  description:
    "Check an accelerator pack's data templates (one CSV per entity in a directory, or the pack's demo set with --demo) before any " +
    "load: mandatory fields, references that resolve, repeated keys (ADR-0026). Needs no " +
    "instance, so it also checks data for test and production, which snagentic never loads. " +
    "Refuses a directory git tracks: customer data is never committed.",
  input: z.object({
    pack: z.string(),
    ...DataSourceInput,
    ...SelectionInput,
  }),
  output: z.object({
    selected: z.array(z.string()).readonly(),
    entities: z
      .array(
        z.object({
          entity: z.string(),
          rows: z.number(),
          problems: z.array(z.string()).readonly(),
        }),
      )
      .readonly(),
    passed: z.boolean(),
  }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  arguments: ["pack"],
  async handle(input, context) {
    return validateData(
      { packs: context.packs, templates: context.dataTemplates },
      {
        pack: input.pack,
        source: dataSourceOf(input, context.host.cwd),
        ...selectionOf(input),
        // Without an instance: --domain checks the templates as a load into a domain would.
        ...(input.domain === undefined
          ? {}
          : { domain: { separated: true as const, name: input.domain, sysId: "" } }),
      },
    );
  },
  render(output) {
    return [
      ...output.entities.flatMap((e) => [
        `${e.problems.length === 0 ? "ok     " : "invalid"} ${e.entity}: ${e.rows} row(s)`,
        ...e.problems.map((p) => `  ${p}`),
      ]),
      output.passed ? "templates pass: ready to load" : "fix the templates, then validate again",
    ].join("\n");
  },
  exitCode: (output) => (output.passed ? 0 : 1),
});
