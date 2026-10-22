import { resolve } from "node:path";
import { type DataSource, DataSourceRequiredError, type Selection } from "@snagentic/core";
import { z } from "zod";

// What every accelerator command selects (ADR-0038): a profile's modules, modules by name, or both.
export const SelectionInput = {
  profile: z.string().optional().describe("install this profile's modules"),
  modules: z.array(z.string()).optional().describe("install these modules (with what they need)"),
};

export const selectionOf = (input: {
  readonly profile?: string | undefined;
  readonly modules?: readonly string[] | undefined;
}): Selection => ({
  ...(input.profile === undefined ? {} : { profile: input.profile }),
  ...(input.modules === undefined ? {} : { modules: input.modules }),
});

// Where data templates come from: a customer directory outside git, or the pack's demo set.
export const DataSourceInput = {
  data: z.string().optional().describe("the directory with the templates, outside the workspace"),
  demo: z.boolean().default(false).describe("use the pack's fictional demo data"),
};

export function dataSourceOf(
  input: { readonly data?: string | undefined; readonly demo: boolean },
  cwd: string,
): DataSource {
  if (input.demo === (input.data !== undefined)) throw new DataSourceRequiredError();
  return input.data === undefined
    ? { kind: "demo" }
    : { kind: "directory", directory: resolve(cwd, input.data) };
}

export const PackSummary = z.object({
  id: z.string(),
  version: z.string(),
  modules: z.array(z.object({ id: z.string(), label: z.string() })).readonly(),
  profiles: z.record(z.string(), z.array(z.string()).readonly()),
});
