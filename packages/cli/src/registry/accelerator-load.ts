import { InstanceError, loadData } from "@snagentic/core";
import { z } from "zod";
import { DataSourceInput, dataSourceOf, SelectionInput, selectionOf } from "./accelerator-schemas";
import { connect } from "./connect";
import { defineUseCase } from "./use-case";

const Counts = z.object({
  inserted: z.number(),
  updated: z.number(),
  ignored: z.number(),
  skipped: z.number(),
  error: z.number(),
});

export const acceleratorLoad = defineUseCase({
  group: "accelerator",
  name: "load",
  description:
    "Load an accelerator pack's data templates (a directory, or the pack's demo set with --demo) into a development instance through the pack's " +
    "import set tables (ADR-0026): every template is validated first and nothing loads until " +
    "all pass; then each entity in order, one row per request, never retried, stopping after " +
    "the first entity with rows the instance did not take. Reports counts and the business keys " +
    "of failed rows, never other values. Test and production are loaded on the instance itself.",
  input: z.object({
    pack: z.string(),
    instance: z.string(),
    ...DataSourceInput,
    ...SelectionInput,
    confirm: z.boolean().default(false).describe("confirm that this writes records"),
  }),
  output: z.object({
    instance: z.string(),
    entities: z
      .array(
        z.object({ entity: z.string(), counts: Counts, failed: z.array(z.string()).readonly() }),
      )
      .readonly(),
    stopped: z.boolean(),
  }),
  flags: { readOnly: false, destructive: true, requiresDevelopmentInstance: true },
  mcp: false,
  arguments: ["pack", "instance"],
  async handle(input, context, run) {
    const { name, reader } = await connect(context, input.instance, run.signal);
    if (reader.imports === undefined) {
      throw new InstanceError("this connection cannot load data through import sets");
    }
    const result = await loadData(
      { packs: context.packs, templates: context.dataTemplates, importer: reader.imports },
      {
        pack: input.pack,
        source: dataSourceOf(input, context.host.cwd),
        confirm: input.confirm,
        signal: run.signal,
        ...selectionOf(input),
      },
    );
    return { instance: name, ...result };
  },
  render(output) {
    return [
      ...output.entities.flatMap((e) => [
        `${e.entity}: ${e.counts.inserted} inserted, ${e.counts.updated} updated, ${e.counts.ignored} unchanged, ${e.counts.skipped + e.counts.error} not taken`,
        ...e.failed.map((key) => `  not taken: ${key}`),
      ]),
      output.stopped
        ? "stopped: fix the rows not taken (see the import set rows on the instance), then load again"
        : `loaded into ${output.instance}`,
    ].join("\n");
  },
  exitCode: (output) => (output.stopped ? 1 : 0),
});
