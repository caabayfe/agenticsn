import { sha256Hex } from "../../kernel/sha256";
import type { InventoryReader } from "../../plugins/index";
import { dataOrder, type Selection, selectCapabilities } from "../domain/capability-graph";
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
import type { DataTemplates, PackSource, PackWorkspace } from "../ports";
import { checkPack, manifestOf, selectionOf } from "./check-pack";
import { type DataSource, validateData } from "./validate-data";

export interface InstallQuery extends Selection {
  readonly pack: string;
  readonly instance: { readonly root: string; readonly name: string; readonly kind: string };
  readonly source: DataSource;
  readonly snagentic: string;
}

export interface InstallPlanDependencies {
  readonly packs: PackSource;
  readonly inventory: InventoryReader;
  readonly workspace: PackWorkspace;
  readonly templates: DataTemplates;
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
    const label = manifest.capabilities.find((c) => c.id === id)?.label ?? `${manifest.id}/${id}`;
    return {
      id,
      label: `${label} ${manifest.version}`,
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
  const mirrorCommit = (await deps.workspace.mirrorCommit()) ?? "";
  const problems = [
    ...check.unknown.map((u) => `the pack has no ${u.startsWith("profile ") ? u : `module ${u}`}`),
    ...(check.report === null
      ? [`pull ${query.instance.name} first: the mirror has no component inventory`]
      : []),
    ...blockingProblems(components, report),
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
    data: { source: query.source.kind, entities },
    problems,
    warnings: report.warnings,
    basis: { mirrorCommit, content: contentOf(files, selected) },
  };
  return { ...plan, planId: installPlanId(plan) };
}
