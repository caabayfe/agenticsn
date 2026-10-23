import { dataOrder } from "../domain/capability-graph";
import { type DataDomain, domainEntity, resolveDataDomain } from "../domain/data-domain";
import type { InstallPlan } from "../domain/install-plan";
import type { Capability, Manifest } from "../domain/manifest-types";
import type { InstallPlanDependencies, InstallQuery } from "./install-query";
import { validateData } from "./validate-data";

// The data the plan loads: each entity's rows, checked as the load will send them, and the
// domain they go into.
export async function plannedData(
  deps: InstallPlanDependencies,
  query: InstallQuery,
  manifest: Manifest,
  selected: readonly string[],
): Promise<{ readonly data: InstallPlan["data"]; readonly problems: readonly string[] }> {
  const domain = await plannedDomain(deps, query, manifest, selected);
  const checked = await validateData(deps, { ...query, domain: domain.domain });
  const entities = dataOrder(manifest, selected).map((e) => ({
    entity: e.entity,
    module: e.module,
    target: e.target,
    rows: checked.entities.find((d) => d.entity === e.entity)?.rows ?? 0,
    anchors: e.anchors,
  }));
  return {
    data: {
      source: query.source.kind,
      entities,
      domain: domain.domain,
      domainColumns: domain.columns,
    },
    problems: [
      ...domain.problems,
      ...checked.entities.flatMap((e) => e.problems.map((p) => `data ${e.entity}: ${p}`)),
    ],
  };
}

// The domain the plan's data goes into, from the mirror's domains and --domain (spec 011,
// section 15). A selection that loads no data needs no domain.
async function plannedDomain(
  deps: Pick<InstallPlanDependencies, "inventory">,
  query: Pick<InstallQuery, "instance" | "domain">,
  manifest: Manifest,
  selected: readonly string[],
): Promise<{ domain: DataDomain; problems: readonly string[]; columns: readonly string[] }> {
  const entities = dataOrder(manifest, selected);
  const columns = entities.flatMap((e) =>
    e.columns.filter((c) => c.domain).map((c) => `${e.entity}.${c.name}`),
  );
  if (entities.length === 0 && query.domain === undefined) {
    return { domain: { separated: false }, problems: [], columns };
  }
  const domains = await deps.inventory.read(query.instance.root, query.instance.name, "domains");
  return { ...resolveDataDomain(domains, query.domain, query.instance.name), columns };
}

// The modules as this instance sees them: their domain columns mandatory or left out, so the
// fields they fill are checked only where they are loaded.
export const domainModules = (modules: readonly Capability[], domain: DataDomain): Capability[] =>
  modules.map((m) => ({ ...m, data: m.data.map((e) => domainEntity(e, domain)) }));
