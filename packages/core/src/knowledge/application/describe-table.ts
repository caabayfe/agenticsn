import { Catalog } from "../../metadata/domain/catalog";
import type { Phase } from "../domain/behavior";
import { fitted } from "../domain/budget";
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
// Items listed per phase before the rest is only counted (design 3.1, rule 3); fewer when
// the result would not fit its budget. One phase asked for alone lists up to PHASE_LIMIT.
const PER_PHASE = 30;
const PHASE_LIMIT = 150;
// Around the save rather than in it: offered on forms (UI actions) or checked on access (ACLs),
// often by the hundred. They get a third of a phase's share; `phase` lists them in full.
const AROUND_THE_SAVE: ReadonlySet<Phase> = new Set(["action", "access"]);

export interface BehaviorItem {
  readonly kind: string;
  readonly name: string;
  readonly order: number;
  // Present only on inactive items (listed when asked for).
  readonly inactive?: true;
  readonly path: string;
  // The fields that describe it, without empty or false values; a business rule's operations
  // are in `on` (insert, update, delete, query).
  readonly details: Readonly<Record<string, string>>;
  // Set when the item is defined on a parent table (it still runs here).
  readonly inheritedFrom?: string;
}

// Compact: defaults are left out (not mandatory, no reference, defined on the table itself).
export interface FieldItem {
  readonly name: string;
  readonly type: string;
  readonly label: string;
  readonly reference?: string;
  readonly mandatory?: true;
  readonly definedOn?: string;
}

export interface DescribeTableOptions {
  readonly includeInactive?: boolean;
  // List only this phase, in full (up to PHASE_LIMIT), without the fields.
  readonly phase?: Phase;
}

export interface TableDescription extends Freshness {
  readonly table: string;
  readonly known: boolean;
  // The table, then each parent up to the root.
  readonly inherits: readonly string[];
  readonly fields: readonly FieldItem[];
  // Fields on the table and its parents, all of them (fields is empty when a phase is asked).
  readonly fieldCount: number;
  readonly behavior: Readonly<Partial<Record<Phase, readonly BehaviorItem[]>>>;
  // Items left out per phase (inactive ones, or beyond the per-phase limit).
  readonly omitted: Readonly<Partial<Record<Phase, number>>>;
  // Active items per phase, all of them (inherited included).
  readonly counts: Readonly<Partial<Record<Phase, number>>>;
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

const OPERATIONS = ["insert", "update", "delete", "query"];

// The details worth reading: no empty or false values, no timing (the phase says it), and a
// business rule's operation flags as one list.
function compactDetails(fields: Readonly<Record<string, string>>): Record<string, string> {
  const on = OPERATIONS.filter((operation) => fields[`action_${operation}`] === "true");
  const kept = Object.entries(fields).filter(
    ([key, value]) =>
      value !== "" && value !== "false" && key !== "when" && !key.startsWith("action_"),
  );
  return Object.fromEntries([...kept, ...(on.length === 0 ? [] : [["on", on.join(", ")]])]);
}

function item(record: IndexedRecord, table: string): BehaviorItem {
  return {
    kind: KIND[record.className] ?? record.className,
    name: record.name,
    order: record.order,
    ...(record.active ? {} : { inactive: true as const }),
    path: `${record.base}.yaml`,
    details: compactDetails(record.fields),
    ...(record.table === table ? {} : { inheritedFrom: record.table ?? "" }),
  };
}

function field(record: IndexedRecord, table: string): FieldItem {
  const reference = record.fields["reference"] ?? "";
  return {
    name: record.fields["element"] ?? record.name,
    type: record.fields["internal_type"] ?? "",
    label: record.fields["column_label"] ?? "",
    ...(reference === "" ? {} : { reference }),
    ...(record.fields["mandatory"] === "true" ? { mandatory: true as const } : {}),
    ...(record.table === table ? {} : { definedOn: record.table ?? "" }),
  };
}

function grouped(
  records: readonly IndexedRecord[],
  table: string,
  includeInactive: boolean,
  limit: number,
) {
  const behavior: Partial<Record<Phase, BehaviorItem[]>> = {};
  const omitted: Partial<Record<Phase, number>> = {};
  const counts: Partial<Record<Phase, number>> = {};
  for (const phase of PHASE_ORDER) {
    const all = records
      .filter((r) => r.phase === phase)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    const shown = all.filter((r) => includeInactive || r.active);
    const active = all.filter((r) => r.active).length;
    if (active > 0) {
      counts[phase] = active;
    }
    const share = AROUND_THE_SAVE.has(phase) ? Math.ceil(limit / 3) : limit;
    if (shown.length > 0) {
      behavior[phase] = shown.slice(0, share).map((r) => item(r, table));
    }
    if (all.length > Math.min(shown.length, share)) {
      omitted[phase] = all.length - Math.min(shown.length, share);
    }
  }
  return { behavior, omitted, counts };
}

// What to ask for next: the first item to read, and the phase with the most active items left
// out, listed alone.
function nextCalls(
  table: string,
  behavior: TableDescription["behavior"],
  counts: TableDescription["counts"],
): NextCall[] {
  const first = behavior.before?.[0] ?? behavior.after?.[0] ?? behavior.client?.[0];
  const hidden = PHASE_ORDER.map((phase) => ({
    phase,
    left: (counts[phase] ?? 0) - (behavior[phase]?.length ?? 0),
  }))
    .filter((p) => p.left > 0)
    .sort((a, b) => b.left - a.left)[0];
  return [
    ...(first === undefined ? [] : [{ tool: "describe", args: { target: first.path } }]),
    ...(hidden === undefined
      ? []
      : [{ tool: "describe", args: { target: table, phase: hidden.phase } }]),
  ];
}

// A table: its fields and everything that runs on it, in execution order, including what
// it inherits from its parents (business rules on task run on incident too).
export async function describeTable(
  deps: KnowledgeDependencies,
  table: string,
  options: DescribeTableOptions = {},
): Promise<TableDescription> {
  const catalog = new Catalog(deps.catalog ?? { parents: {}, scopes: {}, typedFields: {} });
  const inherits = catalog.ancestors(table);
  const records = await deps.store.onTables(inherits);
  // A table's own dictionary row (no element) is the table, not a field.
  const allFields = records
    .filter((r) => r.phase === "field" && (r.fields["element"] ?? "") !== "")
    .map((r) => field(r, table))
    .sort((a, b) => a.name.localeCompare(b.name));
  const phase = options.phase;
  const inScope = phase === undefined ? records : records.filter((r) => r.phase === phase);
  const build = (limit: number): TableDescription => {
    const { behavior, omitted, counts } = grouped(
      inScope,
      table,
      options.includeInactive === true,
      limit,
    );
    return {
      ...freshness(deps),
      table,
      known: deps.catalog?.parents[table] !== undefined,
      inherits,
      fields: phase === undefined ? allFields : [],
      fieldCount: allFields.length,
      behavior,
      omitted,
      counts,
      notCovered: [
        "flows and workflows triggered by this table",
        "business rules on the global table, which run on every table",
      ],
      next: nextCalls(table, behavior, counts),
    };
  };
  return fitted(build, phase === undefined ? PER_PHASE : PHASE_LIMIT);
}
