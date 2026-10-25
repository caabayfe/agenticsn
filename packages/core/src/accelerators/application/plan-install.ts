import { sha256Hex } from "../../kernel/sha256";
import { selectCapabilities } from "../domain/capability-graph";
import type { DataDomain } from "../domain/data-domain";
import { earlierSets, recordedSets } from "../domain/earlier-sets";
import {
  blockingProblems,
  type InstallPlan,
  installPlanId,
  type PlannedModule,
  plannedComponents,
  skippedModules,
} from "../domain/install-plan";
import type { Manifest } from "../domain/manifest-types";
import { materialize } from "../domain/materialize";
import { moduleOf } from "../domain/pack-layout";
import type { PreflightReport } from "../domain/preflight";
import { afterActivation, fieldIssues, requiredFields } from "../domain/required-fields";
import { leftoverProblem, noLongerShipped } from "../domain/upgrade";
import { checkFields } from "./check-fields";
import { checkPack, manifestOf, selectionOf } from "./check-pack";
import type { InstallPlanDependencies, InstallQuery } from "./install-query";
import { domainModules, plannedData } from "./plan-data";

export type { InstallPlanDependencies, InstallQuery } from "./install-query";

// The selected modules' platform fields against the mirror; none checked before its first pull.
async function plannedFields(
  deps: InstallPlanDependencies,
  manifest: Manifest,
  selected: readonly string[],
  instance: string,
  facts: { readonly activated: ReadonlySet<string>; readonly domain: DataDomain },
) {
  const { activated, domain } = facts;
  const modules = domainModules(
    manifest.capabilities.filter((c) => selected.includes(c.id)),
    domain,
  );
  if (!modules.some((m) => requiredFields(m).length > 0)) {
    return { fields: [], problems: [], warnings: [] };
  }
  if (!(await deps.schema.ready())) {
    const problem = `pull ${instance} first: the mirror holds no tables, so the fields the modules read cannot be checked`;
    return { fields: [], problems: [problem], warnings: [] };
  }
  const fields = afterActivation(await checkFields(modules, deps.schema), activated);
  return { fields, ...fieldIssues(fields) };
}

// The label a module's update sets carry, before the pack's version.
const labelOf = (manifest: Manifest, id: string) =>
  manifest.capabilities.find((c) => c.id === id)?.label ?? `${manifest.id}/${id}`;

// The pack's update sets from older versions still in progress, by any module of the pack
// (ADR-0038, section 6): known by their names or by the reports of earlier installs.
async function plannedEarlierSets(
  deps: InstallPlanDependencies,
  manifest: Manifest,
  signal: AbortSignal,
) {
  const reports = await deps.workspace.installReports(manifest.id);
  const naming = {
    pack: manifest.id,
    version: manifest.version,
    labels: manifest.capabilities.map((c) => labelOf(manifest, c.id)),
    recorded: reports.flatMap(recordedSets),
  };
  return earlierSets(naming, await deps.updateSets.open(signal));
}

// What each selected module writes on its own, and its update set's label.
function plannedModules(
  manifest: Manifest,
  selected: readonly string[],
  files: ReadonlyMap<string, string>,
  parse: (text: string) => unknown,
): { modules: PlannedModule[]; problems: string[] } {
  const problems: string[] = [];
  const modules = selected.map((id) => {
    const result = materialize({ selected: [id], files, parse });
    problems.push(...result.problems);
    return {
      id,
      label: `${labelOf(manifest, id)} ${manifest.version}`,
      files: result.files.map((f) => f.path),
      adoptions: result.adoptions,
      ensures: result.ensures,
    };
  });
  return { modules, problems };
}

// Files the pack's last add wrote that no module of this version ships, still in the workspace.
async function plannedLeftovers(
  deps: InstallPlanDependencies,
  manifest: Manifest,
  files: ReadonlyMap<string, string>,
) {
  const all = manifest.capabilities.map((c) => c.id);
  const shipped = materialize({ selected: all, files, parse: (t) => deps.packs.parse(t) });
  const gone = noLongerShipped(
    await deps.workspace.previous(manifest.id),
    shipped.files.map((f) => f.path),
  );
  return gone.length === 0 ? [] : [...(await deps.workspace.present(gone))].sort();
}

// A digest of the selected modules' files, so a change to the pack changes the plan id.
const contentOf = (files: ReadonlyMap<string, string>, selected: readonly string[]) =>
  sha256Hex(
    [...files]
      .filter(([path]) => {
        const module = moduleOf(path);
        return module !== null && selected.includes(module);
      })
      .map(([path, text]) => `${path}\n${sha256Hex(text)}`)
      .join("\n"),
  );

// The modules the plan installs, and those it skips: a module needing a component the install
// cannot install is skipped, with its dependents, and the rest installs (owner, 2026-10-24).
// The report it returns holds the kept modules only, so a skipped module's plugin is not
// activated.
function keptModules(report: PreflightReport, chosen: readonly string[]) {
  const skipped = skippedModules(plannedComponents(report), report);
  const selected = chosen.filter((id) => !skipped.some((s) => s.id === id));
  const kept = {
    ...report,
    capabilities: report.capabilities.filter((c) => selected.includes(c.id)),
  };
  return { skipped, selected, kept };
}

// The components the plan installs, and the platform fields its modules read, checked knowing
// which components it activates and the domain its data goes into.
async function plannedPlatform(
  deps: InstallPlanDependencies,
  query: InstallQuery,
  manifest: Manifest,
  selected: readonly string[],
  facts: { readonly report: PreflightReport; readonly domain: DataDomain },
) {
  const components = plannedComponents(facts.report);
  const activated = new Set(components.filter((c) => c.action === "activate").map((c) => c.id));
  const required = await plannedFields(deps, manifest, selected, query.instance.name, {
    activated,
    domain: facts.domain,
  });
  return { components, required };
}

// The install plan (ADR-0038, item 2.1): reads the pack and the mirror, writes nothing.
export async function planInstall(
  deps: InstallPlanDependencies,
  query: InstallQuery,
): Promise<InstallPlan> {
  const selection = selectionOf(query);
  const check = await checkPack(deps, {
    ...selection,
    pack: query.pack,
    instance: query.instance,
    snagentic: query.snagentic,
  });
  const manifest = await manifestOf(deps.packs, query.pack);
  const files = await deps.packs.files(query.pack);
  const { capabilities: chosen } = selectCapabilities(manifest, selection);
  const report = check.report ?? { problems: [], warnings: [], capabilities: [] };
  const { skipped, selected, kept } = keptModules(report, chosen);
  const built = plannedModules(manifest, selected, files, (t) => deps.packs.parse(t));
  const planned = await plannedData(deps, query, manifest, selected);
  const { components, required } = await plannedPlatform(deps, query, manifest, selected, {
    report: kept,
    domain: planned.data.domain,
  });
  const leftovers = await plannedLeftovers(deps, manifest, files);
  const leftover = leftoverProblem(leftovers);
  const problems = [
    ...check.unknown.map((u) => `the pack has no ${u.startsWith("profile ") ? u : `module ${u}`}`),
    ...(check.report === null
      ? [`pull ${query.instance.name} first: the mirror has no component inventory`]
      : []),
    ...blockingProblems(report, { kept: selected.length, skipped: skipped.length }),
    ...required.problems,
    ...built.problems,
    ...planned.problems,
    ...(leftover === null ? [] : [leftover]),
  ];
  const plan = {
    pack: manifest.id,
    version: manifest.version,
    instance: { name: query.instance.name, kind: query.instance.kind },
    selection,
    modules: built.modules,
    skipped,
    components,
    fields: required.fields,
    earlierSets: await plannedEarlierSets(deps, manifest, query.signal),
    data: planned.data,
    leftovers,
    problems,
    warnings: [...report.warnings, ...required.warnings],
    basis: {
      mirrorCommit: (await deps.workspace.mirrorCommit()) ?? "",
      content: contentOf(files, selected),
    },
  };
  return { ...plan, planId: installPlanId(plan) };
}
