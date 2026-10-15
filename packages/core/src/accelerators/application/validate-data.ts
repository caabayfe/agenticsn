import { dataOrder, selectCapabilities } from "../domain/capability-graph";
import { InvalidPackError, PackNotFoundError, TrackedDataError } from "../domain/errors";
import { parseManifest } from "../domain/manifest";
import { type Template, type TemplateReport, validateTemplates } from "../domain/templates";
import type { DataTemplates, PackSource } from "../ports";

export interface DataQuery {
  readonly pack: string;
  readonly directory: string;
  readonly waves?: readonly number[];
  readonly capabilities?: readonly string[];
}

// Checks a data directory's templates against the pack's data entities, without an instance
// (ADR-0026, item 3: the same check runs before any load, and stands alone for test and
// production, which snagentic never loads).
export async function validateData(
  deps: { readonly packs: PackSource; readonly templates: DataTemplates },
  query: DataQuery,
): Promise<TemplateReport & { readonly selected: readonly string[] }> {
  const document = await deps.packs.manifest(query.pack);
  if (document === null) throw new PackNotFoundError(query.pack, await deps.packs.ids());
  const outcome = parseManifest(document);
  if (!outcome.ok) throw new InvalidPackError(query.pack, outcome.problems);
  if (await deps.templates.tracked(query.directory)) throw new TrackedDataError(query.directory);
  const { capabilities: selected } = selectCapabilities(outcome.manifest, {
    ...(query.waves === undefined ? {} : { waves: query.waves }),
    ...(query.capabilities === undefined ? {} : { capabilities: query.capabilities }),
  });
  const entities = dataOrder(outcome.manifest, selected);
  const templates = new Map<string, Template>();
  for (const entity of entities) {
    const template = await deps.templates.read(query.directory, entity.file);
    if (template !== null) templates.set(entity.entity, template);
  }
  return { selected, ...validateTemplates(entities, templates) };
}
