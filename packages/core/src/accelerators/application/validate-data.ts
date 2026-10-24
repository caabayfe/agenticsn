import { dataOrder, type Selection, selectCapabilities } from "../domain/capability-graph";
import { type DataDomain, domainEntity } from "../domain/data-domain";
import { TrackedDataError } from "../domain/errors";
import type { DataEntity } from "../domain/manifest-types";
import { demoPath } from "../domain/pack-layout";
import { type Template, type TemplateReport, validateTemplates } from "../domain/templates";
import type { DataTemplates, PackSource } from "../ports";
import { manifestOf, selectionOf } from "./check-pack";

// Where the templates come from: a customer's directory outside git, or the pack's own
// fictional demo set (modules/<module>/data/demo/, ADR-0038).
export type DataSource =
  | { readonly kind: "directory"; readonly directory: string }
  | { readonly kind: "demo" };

export interface DataQuery extends Selection {
  readonly pack: string;
  readonly source: DataSource;
  // The instance's domains, when a load is planned for one: without it the templates are checked
  // as the pack declares them (spec 011, section 15).
  readonly domain?: DataDomain;
}

// The templates of a selection's entities, by entity, from the query's source.
export async function readTemplates(
  deps: { readonly packs: PackSource; readonly templates: DataTemplates },
  query: DataQuery,
  entities: readonly (DataEntity & { readonly module: string })[],
): Promise<Map<string, Template>> {
  const templates = new Map<string, Template>();
  const files = query.source.kind === "demo" ? await deps.packs.files(query.pack) : null;
  for (const entity of entities) {
    const text = files?.get(demoPath(entity.module, entity.file));
    const template =
      query.source.kind === "directory"
        ? await deps.templates.read(query.source.directory, entity.file)
        : text === undefined
          ? null
          : deps.templates.parse(text);
    if (template !== null) templates.set(entity.entity, template);
  }
  return templates;
}

// Checks a data set's templates against the pack's data entities, without an instance
// (ADR-0026, item 3: the same check runs before any load, and stands alone for test and
// production, which snagentic never loads).
export async function validateData(
  deps: { readonly packs: PackSource; readonly templates: DataTemplates },
  query: DataQuery,
): Promise<TemplateReport & { readonly selected: readonly string[] }> {
  const manifest = await manifestOf(deps.packs, query.pack);
  if (query.source.kind === "directory" && (await deps.templates.tracked(query.source.directory))) {
    throw new TrackedDataError(query.source.directory);
  }
  const { capabilities: selected } = selectCapabilities(manifest, selectionOf(query));
  const domain = query.domain;
  const ordered = dataOrder(manifest, selected);
  const entities = domain === undefined ? ordered : ordered.map((e) => domainEntity(e, domain));
  const templates = await readTemplates(deps, query, entities);
  return { selected, ...validateTemplates(entities, templates) };
}
