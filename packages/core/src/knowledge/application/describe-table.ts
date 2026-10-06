import { Catalog } from "../../metadata/domain/catalog";
import type { Phase } from "../domain/behavior";
import type { IndexedRecord } from "../domain/indexed-record";
import { freshness } from "./freshness";
import type { Freshness, KnowledgeDependencies, NextCall } from "./knowledge-dependencies";

// How the platform runs a save, in order, then what surrounds it.
export const PHASE_ORDER: readonly Phase[] = [
  "client",
  "action",
  "query",
  "display",
  "before",
  "after",
  "async",
  "notify",
  "policy",
  "access",
];
// Items listed per phase before the rest is only counted (design 3.1, rule 3).
const PER_PHASE = 30;

export interface BehaviorItem {
  readonly kind: string;
  readonly name: string;
  readonly order: number;
  readonly active: boolean;
  readonly path: string;
  readonly details: Readonly<Record<string, string>>;
  // Set when the item is defined on a parent table (it still runs here).
  readonly inheritedFrom?: string;
}

export interface FieldItem {
  readonly name: string;
  readonly type: string;
  readonly label: string;
  readonly reference: string;
  readonly mandatory: boolean;
  readonly definedOn: string;
  readonly path: string;
}

export interface TableDescription extends Freshness {
  readonly table: string;
  readonly known: boolean;
  // The table, then each parent up to the root.
  readonly inherits: readonly string[];
  readonly fields: readonly FieldItem[];
  readonly behavior: Readonly<Partial<Record<Phase, readonly BehaviorItem[]>>>;
  // Items left out per phase (inactive ones, or beyond the per-phase limit).
  readonly omitted: Readonly<Partial<Record<Phase, number>>>;
  readonly notCovered: readonly string[];
  readonly next: readonly NextCall[];
}

const KIND: Readonly<Record<string, string>> = {
  sys_script: "business rule",
  sys_script_client: "client script",
  sys_ui_policy: "UI policy",
  sys_ui_action: "UI action",
  sys_security_acl: "ACL",
  sysevent_email_action: "notification",
  sys_data_policy2: "data policy",
};

function item(record: IndexedRecord, table: string): BehaviorItem {
  return {
    kind: KIND[record.className] ?? record.className,
    name: record.name,
    order: record.order,
    active: record.active,
    path: `${record.base}.yaml`,
    details: record.fields,
    ...(record.table === table ? {} : { inheritedFrom: record.table ?? "" }),
  };
}

function field(record: IndexedRecord): FieldItem {
  return {
    name: record.fields["element"] ?? record.name,
    type: record.fields["internal_type"] ?? "",
    label: record.fields["column_label"] ?? "",
    reference: record.fields["reference"] ?? "",
    mandatory: record.fields["mandatory"] === "true",
    definedOn: record.table ?? "",
    path: `${record.base}.yaml`,
  };
}

function grouped(records: readonly IndexedRecord[], table: string, includeInactive: boolean) {
  const behavior: Partial<Record<Phase, BehaviorItem[]>> = {};
  const omitted: Partial<Record<Phase, number>> = {};
  for (const phase of PHASE_ORDER) {
    const all = records
      .filter((r) => r.phase === phase)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    const shown = all.filter((r) => includeInactive || r.active);
    if (shown.length > 0) {
      behavior[phase] = shown.slice(0, PER_PHASE).map((r) => item(r, table));
    }
    if (all.length > Math.min(shown.length, PER_PHASE)) {
      omitted[phase] = all.length - Math.min(shown.length, PER_PHASE);
    }
  }
  return { behavior, omitted };
}

// A table: its fields and everything that runs on it, in execution order, including what
// it inherits from its parents (business rules on task run on incident too).
export async function describeTable(
  deps: KnowledgeDependencies,
  table: string,
  includeInactive = false,
): Promise<TableDescription> {
  const catalog = new Catalog(deps.catalog ?? { parents: {}, scopes: {}, typedFields: {} });
  const inherits = catalog.ancestors(table);
  const records = await deps.store.onTables(inherits);
  const fields = records
    .filter((r) => r.phase === "field")
    .map(field)
    .sort((a, b) => a.name.localeCompare(b.name));
  const { behavior, omitted } = grouped(records, table, includeInactive);
  const first = behavior.before?.[0] ?? behavior.after?.[0] ?? behavior.client?.[0];
  return {
    ...freshness(deps),
    table,
    known: deps.catalog?.parents[table] !== undefined,
    inherits,
    fields,
    behavior,
    omitted,
    notCovered: [
      "flows and workflows triggered by this table",
      "business rules on the global table, which run on every table",
    ],
    next: first === undefined ? [] : [{ tool: "describe", args: { target: first.path } }],
  };
}
