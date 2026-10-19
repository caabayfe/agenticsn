import { dataOrder } from "../domain/capability-graph";
import { LoadConfirmationRequiredError, TemplatesInvalidError } from "../domain/errors";
import type { DataEntity } from "../domain/manifest-types";
import { stagingRow, type Template } from "../domain/templates";
import type { DataTemplates, ImportSetWriter, ImportStatus, PackSource } from "../ports";
import { manifestOf } from "./check-pack";
import { type DataQuery, readTemplates, validateData } from "./validate-data";

export interface EntityLoad {
  readonly entity: string;
  readonly counts: Readonly<Record<ImportStatus, number>>;
  // Business keys of the rows the instance did not take: never other field values (ASR-08).
  readonly failed: readonly string[];
}

export interface LoadResult {
  readonly entities: readonly EntityLoad[];
  // The load stopped after an entity with failed rows; later entities were not loaded.
  readonly stopped: boolean;
}

const EMPTY: Record<ImportStatus, number> = {
  inserted: 0,
  updated: 0,
  ignored: 0,
  skipped: 0,
  error: 0,
};

async function loadEntity(
  importer: ImportSetWriter,
  entity: DataEntity,
  template: Template,
  signal: AbortSignal,
): Promise<EntityLoad> {
  const counts = { ...EMPTY };
  const failed: string[] = [];
  const index = (column: string) => template.columns.indexOf(column);
  for (const row of template.rows) {
    signal.throwIfAborted();
    const values = stagingRow(entity.table, template.columns, row);
    const { status } = await importer.post(entity.table, values, signal);
    counts[status] += 1;
    if (status === "error" || status === "skipped") {
      failed.push(entity.key.map((k) => (row[index(k)] ?? "").trim()).join(" / "));
    }
  }
  return { entity: entity.entity, counts, failed };
}

// Loads a pack's data templates through its import set tables, on a development instance
// (ADR-0026, item 3): validated first (nothing loads until every template passes), then each
// entity in load order, stopping after the first entity with rows the instance did not take.
export async function loadData(
  deps: {
    readonly packs: PackSource;
    readonly templates: DataTemplates;
    readonly importer: ImportSetWriter;
  },
  query: DataQuery & { readonly confirm: boolean; readonly signal: AbortSignal },
): Promise<LoadResult> {
  if (!query.confirm) throw new LoadConfirmationRequiredError();
  const report = await validateData(deps, query);
  const problems = report.entities.reduce((n, e) => n + e.problems.length, 0);
  if (!report.passed) throw new TemplatesInvalidError(query.pack, problems);
  const manifest = await manifestOf(deps.packs, query.pack);
  const entities = dataOrder(manifest, report.selected);
  const templates = await readTemplates(deps, query, entities);
  const loads: EntityLoad[] = [];
  for (const entity of entities) {
    const template = templates.get(entity.entity);
    if (template === undefined) continue;
    const load = await loadEntity(deps.importer, entity, template, query.signal);
    loads.push(load);
    if (load.failed.length > 0) return { entities: loads, stopped: true };
  }
  return { entities: loads, stopped: false };
}
