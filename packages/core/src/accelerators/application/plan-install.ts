import { sha256Hex } from "../../kernel/sha256";
import type { InventoryReader } from "../../plugins/index";
import { dataOrder, type Selection, selectCapabilities } from "../domain/capability-graph";
import { earlierSets, recordedSets } from "../domain/earlier-sets";
import {
  blockingProblems,
  type InstallPlan,
  installPlanId,
  type PlannedModule,
  plannedComponents,
} from "../domain/install-plan";
import type { Manifest } from "../domain/manifest-types";
import { materialize } from "../domain/materialize";
import { moduleOf } from "../domain/pack-layout";
import { fieldIssues, requiredFields } from "../domain/required-fields";
import type {
  DataTemplates,
  OpenUpdateSets,
  PackSource,
  PackWorkspace,
  SchemaReader,
} from "../ports";
import { checkFields } from "./check-fields";
import { checkPack, manifestOf, selectionOf } from "./check-pack";
import { type DataSource, validateData } from "./validate-data";

export interface InstallQuery extends Selection {
  readonly pack: string;
  readonly instance: { readonly root: string; readonly name: string; readonly kind: string };
  readonly source: DataSource;
  readonly snagentic: string;
  readonly signal: AbortSignal;
}

export interface InstallPlanDependencies {
  readonly packs: PackSource;
  readonly inventory: InventoryReader;
  readonly workspace: PackWorkspace;
  readonly templates: DataTemplates;
  // The mirror's tables, for the platform fields the modules read (plan gap G13).
  readonly schema: SchemaReader;
  // The instance's update sets in progress, read live: the pack's earlier ones are completed.
  readonly updateSets: OpenUpdateSets;
}

// The selected modules' platform fields against the mirror; none checked before its first pull.
async function plannedFields(
  deps: InstallPlanDependencies,
  manifest: Manifest,
  selected: readonly string[],
  instance: string,
) {
  const modules = manifest.capabilities.filter((c) => selected.includes(c.id));
  if (!modules.some((m) => requiredFields(m).length > 0)) {
    return { fields: [], problems: [], warnings: [] };
  }
  if (!(await deps.schema.ready())) {
    const problem = `pull ${instance} first: the mirror holds no tables, so the fields the modules read cannot be checked`;
    return { fields: [], problems: [problem], warnings: [] };
  }
  const fields = await checkFields(modules, deps.schema);
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
    };
  });
  return { modules, problems };
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
  const { capabilities: selected } = selectCapabilities(manifest, selection);
  const built = plannedModules(manifest, selected, files, (t) => deps.packs.parse(t));
  const report = check.report ?? { problems: [], warnings: [], capabilities: [] };
  const components = plannedComponents(report);
  const data = await validateData(deps, { ...selection, pack: query.pack, source: query.source });
  const entities = dataOrder(manifest, selected).map((e) => ({
    entity: e.entity,
    module: e.module,
    target: e.target,
    rows: data.entities.find((d) => d.entity === e.entity)?.rows ?? 0,
    anchors: e.anchors,
  }));
  const required = await plannedFields(deps, manifest, selected, query.instance.name);
  const mirrorCommit = (await deps.workspace.mirrorCommit()) ?? "";
  const problems = [
    ...check.unknown.map((u) => `the pack has no ${u.startsWith("profile ") ? u : `module ${u}`}`),
    ...(check.report === null
      ? [`pull ${query.instance.name} first: the mirror has no component inventory`]
      : []),
    ...blockingProblems(components, report),
    ...required.problems,
    ...built.problems,
    ...data.entities.flatMap((e) => e.problems.map((p) => `data ${e.entity}: ${p}`)),
  ];
  const plan = {
    pack: manifest.id,
    version: manifest.version,
    instance: { name: query.instance.name, kind: query.instance.kind },
    selection,
    modules: built.modules,
    components,
    fields: required.fields,
    earlierSets: await plannedEarlierSets(deps, manifest, query.signal),
    data: { source: query.source.kind, entities },
    problems,
    warnings: [...report.warnings, ...required.warnings],
    basis: { mirrorCommit, content: contentOf(files, selected) },
  };
  return { ...plan, planId: installPlanId(plan) };
}
