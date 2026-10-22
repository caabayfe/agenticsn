import type { DataEntity } from "./manifest-types";

// Checks a data set's templates before anything is loaded (ADR-0026, item 3; functional design:
// "nothing is imported until it passes"). Pure. Problems name a row by its number and business
// key, and a column by name: never another field's value (ASR-08).

export interface Template {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface EntityReport {
  readonly entity: string;
  readonly rows: number;
  readonly problems: readonly string[];
}

export interface TemplateReport {
  readonly entities: readonly EntityReport[];
  readonly passed: boolean;
}

const cell = (template: Template, row: readonly string[], column: string) => {
  const index = template.columns.indexOf(column);
  return index < 0 ? "" : (row[index] ?? "").trim();
};

const keyOf = (entity: DataEntity, template: Template, row: readonly string[]) =>
  entity.key.map((k) => cell(template, row, k)).join(" / ");

function columnProblems(entity: DataEntity, template: Template, loaded: ReadonlySet<string>) {
  // Key and mandatory columns must be there; an optional column may be left out.
  const needed = entity.columns.filter((c) => c.required).map((c) => c.name);
  const defined = [...new Set([...entity.key, ...needed])];
  return [
    ...defined
      .filter((c) => !template.columns.includes(c))
      .map((c) => `${c}: the template has no such column`),
    ...entity.columns
      .filter((c) => c.references !== null && !loaded.has(c.references))
      .map((c) => `${c.name} references ${c.references}, which this selection does not load`),
  ];
}

const SYS_ID = /^[0-9a-f]{32}$/;

// An anchor's fixed sys_id (ADR-0038, item 7): 32 lowercase hexadecimal characters, each used
// once. Rows without one are matched by their business key. Only an entity marked `anchors`
// may carry them: elsewhere the transform would not keep them.
function anchorProblems(entity: DataEntity, template: Template): string[] {
  const index = template.columns.indexOf("sys_id");
  if (index < 0) return [];
  if (!entity.anchors) {
    return [
      "sys_id: this entity has no anchors (anchors: true in module.yaml), so the column would be ignored",
    ];
  }
  const problems: string[] = [];
  const seen = new Map<string, number>();
  template.rows.forEach((row, i) => {
    const id = (row[index] ?? "").trim();
    if (id === "") return;
    const label = `row ${i + 1} (${keyOf(entity, template, row)})`;
    if (!SYS_ID.test(id))
      problems.push(`${label}: sys_id must be 32 lowercase hexadecimal characters`);
    const first = seen.get(id);
    if (first !== undefined) problems.push(`${label}: sys_id repeats row ${first}`);
    else seen.set(id, i + 1);
  });
  return problems;
}

function rowProblems(
  entity: DataEntity,
  template: Template,
  keys: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const problems: string[] = [];
  const seen = new Map<string, number>();
  template.rows.forEach((row, index) => {
    const key = keyOf(entity, template, row);
    const label = `row ${index + 1} (${key})`;
    const first = seen.get(key);
    if (first !== undefined) problems.push(`${label}: the key repeats row ${first}`);
    else seen.set(key, index + 1);
    for (const column of entity.columns) {
      const value = cell(template, row, column.name);
      if (value === "") {
        if (column.required) problems.push(`${label}: ${column.name} is mandatory`);
        continue;
      }
      const targets = column.references === null ? undefined : keys.get(column.references);
      if (targets !== undefined && !targets.has(value)) {
        problems.push(
          `${label}: ${column.name} names ${column.references} ${value}, which the ${column.references} template does not hold`,
        );
      }
    }
  });
  return problems;
}

// `entities` in load order (dataOrder); `templates` by entity.
export function validateTemplates(
  entities: readonly DataEntity[],
  templates: ReadonlyMap<string, Template>,
): TemplateReport {
  const loaded = new Set(entities.map((e) => e.entity));
  const keys = new Map(
    entities.flatMap((e) => {
      const template = templates.get(e.entity);
      return template === undefined
        ? []
        : [[e.entity, new Set(template.rows.map((r) => keyOf(e, template, r)))] as const];
    }),
  );
  const reports = entities.map((entity): EntityReport => {
    const template = templates.get(entity.entity);
    if (template === undefined) {
      return { entity: entity.entity, rows: 0, problems: [`${entity.file} is missing`] };
    }
    const columns = columnProblems(entity, template, loaded);
    const problems =
      columns.length > 0
        ? columns
        : [...rowProblems(entity, template, keys), ...anchorProblems(entity, template)];
    return { entity: entity.entity, rows: template.rows.length, problems };
  });
  return { entities: reports, passed: reports.every((r) => r.problems.length === 0) };
}

// The import set row a template row becomes (spike S-D). A staging table created in global is
// named u_... and so are its columns, so a template column `name` is posted as `u_name`; other
// tables take the template's column names as they are. A template's `sys_id` (an anchor's fixed
// id) is always posted as u_sys_id: the Import Set API would make it the row's own sys_id.
export function stagingRow(
  table: string,
  columns: readonly string[],
  row: readonly string[],
): Record<string, string> {
  const custom = table.startsWith("u_");
  const name = (column: string) =>
    (custom || column === "sys_id") && !column.startsWith("u_") ? `u_${column}` : column;
  return Object.fromEntries(columns.map((c, i) => [name(c), (row[i] ?? "").trim()]));
}
