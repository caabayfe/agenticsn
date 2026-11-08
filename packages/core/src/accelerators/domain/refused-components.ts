import type { InstallPlan, InstallRecord, PlannedComponent, SkippedModule } from "./install-plan";

// A licensed component the instance refused while the install ran: the store offered it, so the
// plan installed it, and the platform's installer then said no (pdi2, 2026-11-07: "Unable to
// download app package"). The install leaves its modules out and goes on (owner, 2026-11-08).
export interface RefusedComponent {
  readonly kind: PlannedComponent["kind"];
  readonly id: string;
  readonly reason: string;
}

// The step that records a module left out while the install ran.
const SKIP_PREFIX = "skip module ";
export const skipStep = (module: string) => `${SKIP_PREFIX}${module}`;

// The modules that need a refused component, then those that depend on a skipped one; the plan's
// modules come dependencies first, so one pass finds them all.
function refusedModules(plan: InstallPlan, refused: readonly RefusedComponent[]): SkippedModule[] {
  const skipped: SkippedModule[] = [];
  for (const module of plan.modules) {
    const own = refused.find((r) =>
      plan.components.some(
        (c) => c.kind === r.kind && c.id === r.id && c.modules.includes(module.id),
      ),
    );
    const upstream = module.dependsOn.filter((d) => skipped.some((s) => s.id === d));
    if (own !== undefined) {
      skipped.push({
        id: module.id,
        reason: `needs ${own.kind} ${own.id}: the instance refused it (${own.reason}); run the install again once the instance is entitled`,
      });
    } else if (upstream.length > 0) {
      const verb = upstream.length > 1 ? "are" : "is";
      skipped.push({
        id: module.id,
        reason: `depends on ${upstream.join(", ")}, which ${verb} skipped`,
      });
    }
  }
  return skipped;
}

// The plan the rest of the run follows: without the refused components' modules, their fields and
// their data. The plan the admin approved keeps its id; the report names what was left out.
export function withoutRefused(
  plan: InstallPlan,
  refused: readonly RefusedComponent[],
): { readonly plan: InstallPlan; readonly skipped: readonly SkippedModule[] } {
  const skipped = refused.length === 0 ? [] : refusedModules(plan, refused);
  if (skipped.length === 0) return { plan, skipped };
  const gone = new Set(skipped.map((s) => s.id));
  return {
    plan: {
      ...plan,
      modules: plan.modules.filter((m) => !gone.has(m.id)),
      skipped: [...plan.skipped, ...skipped],
      fields: plan.fields.filter((f) => !gone.has(f.module)),
      data: { ...plan.data, entities: plan.data.entities.filter((e) => !gone.has(e.module)) },
    },
    skipped,
  };
}

// The report's result of a run that finished: installed, or installed without the modules it left
// out (a resumed run that installed one after all names it no more).
export function installedResult(record: InstallRecord): string {
  const delivered = new Set(record.steps.filter((s) => s.outcome === "done").map((s) => s.step));
  const left = record.steps
    .filter((s) => s.step.startsWith(SKIP_PREFIX))
    .map((s) => s.step.slice(SKIP_PREFIX.length))
    .filter((id) => !delivered.has(`module ${id}`));
  if (left.length === 0) return "installed";
  return `installed without ${left.join(", ")}, which need a component the instance refused: run the install again once the instance is entitled`;
}
