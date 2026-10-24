import { fieldIssues, type InstallPlan } from "@snagentic/core";
import { z } from "zod";

// The plan's facts the text output shows in sections: the plugins it activates, and the missing
// platform fields grouped by field (several modules can read one).

export const InstallViewOutput = {
  pack: z.string(),
  version: z.string(),
  instance: z.string(),
  activates: z
    .array(z.object({ id: z.string(), modules: z.array(z.string()).readonly() }))
    .readonly()
    .describe("the inactive plugins the install activates, and the modules that need them"),
  missingFields: z
    .array(
      z.object({
        field: z.string(),
        from: z.string().nullable(),
        blocking: z.boolean(),
        modules: z
          .array(z.object({ module: z.string(), effect: z.string().nullable() }))
          .readonly(),
      }),
    )
    .readonly()
    .describe("platform fields the instance lacks, with what each module loses without them"),
  notes: z.array(z.string()).readonly().describe("warnings other than missing fields"),
};

// Several modules can read one field: one entry per field, with each module's loss.
export function missingFields(fields: InstallPlan["fields"]) {
  const groups = new Map<
    string,
    {
      field: string;
      from: string | null;
      blocking: boolean;
      modules: { module: string; effect: string | null }[];
    }
  >();
  for (const f of fields) {
    if (f.state !== "missing" && f.state !== "no-table") continue;
    const field = `${f.table}.${f.field}`;
    const group = groups.get(field) ?? { field, from: f.from, blocking: false, modules: [] };
    group.blocking ||= f.whenMissing === "stop";
    group.modules.push({ module: f.module, effect: f.whenMissing === "warn" ? f.note : null });
    groups.set(field, group);
  }
  return [...groups.values()];
}

// The plugins the install activates, and the modules that need them.
export const activations = (components: InstallPlan["components"]) =>
  components.filter((c) => c.action === "activate").map((c) => ({ id: c.id, modules: c.modules }));

// The warnings other than missing fields, which the output shows in their own section.
export function notesOf(plan: Pick<InstallPlan, "fields" | "warnings">): string[] {
  const fieldWarnings = new Set(fieldIssues(plan.fields).warnings);
  return plan.warnings.filter((w) => !fieldWarnings.has(w));
}

export function installView(plan: InstallPlan) {
  return {
    pack: plan.pack,
    version: plan.version,
    instance: plan.instance.name,
    activates: activations(plan.components),
    missingFields: missingFields(plan.fields),
    notes: notesOf(plan),
  };
}
