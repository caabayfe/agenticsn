// The census of a process (ADR-0040): every record that reaches the process's tables, grouped by
// the application (scope) that owns it, so each application can be given a decision.

// Which parent tables a signal follows: none, all (actions on task appear on incident), or only
// from applications other than the platform's own (a table referring to task from an
// application usually extends every task; the platform's own references are the platform).
export type Inherit = "none" | "all" | "apps";

export interface CensusSignal {
  readonly table: string;
  // The field naming the table the record reaches.
  readonly field: string;
  readonly kind: string;
  // The fields that give the name a person sees, first non-empty wins.
  readonly names: readonly string[];
  readonly inherit: Inherit;
}

export const CENSUS_SIGNALS: readonly CensusSignal[] = [
  {
    table: "sys_ui_action",
    field: "table",
    kind: "Form and list actions",
    names: ["name"],
    inherit: "all",
  },
  {
    table: "sys_declarative_action_assignment",
    field: "table",
    kind: "Workspace actions",
    names: ["label", "action_name"],
    inherit: "all",
  },
  {
    table: "sys_script",
    field: "collection",
    kind: "Business rules",
    names: ["name"],
    inherit: "none",
  },
  {
    table: "sys_script_client",
    field: "table",
    kind: "Client scripts",
    names: ["name"],
    inherit: "none",
  },
  {
    table: "sys_ui_policy",
    field: "table",
    kind: "UI policies",
    names: ["short_description"],
    inherit: "none",
  },
  {
    table: "sysevent_email_action",
    field: "collection",
    kind: "Notifications",
    names: ["name"],
    inherit: "none",
  },
  {
    table: "contract_sla",
    field: "collection",
    kind: "SLA definitions",
    names: ["name"],
    inherit: "none",
  },
  {
    table: "sys_dictionary",
    field: "reference",
    kind: "Tables that refer to it",
    names: ["name"],
    inherit: "apps",
  },
];

export const PLATFORM_SCOPE = "global";

export interface CensusRecord {
  readonly sysId: string;
  readonly scope: string;
  readonly fields: Readonly<Record<string, string>>;
}

export interface CensusItem {
  readonly kind: string;
  readonly count: number;
  // Distinct names, sorted.
  readonly names: readonly string[];
}

export interface CensusGroup {
  readonly scope: string;
  readonly title: string;
  readonly records: number;
  readonly items: readonly CensusItem[];
}

// The process's tables and every table they extend, from sys_db_object (name, super_class as
// the parent's sys_id).
export function ancestorsOf(
  tables: readonly string[],
  definitions: readonly {
    readonly sysId: string;
    readonly fields: Readonly<Record<string, string>>;
  }[],
): readonly string[] {
  const bySysId = new Map(definitions.map((item) => [item.sysId, item.fields]));
  const byName = new Map(definitions.map((item) => [item.fields["name"] ?? "", item.fields]));
  const found: string[] = [];
  for (const table of tables) {
    let parent = byName.get(table)?.["super_class"] ?? "";
    while (parent !== "") {
      const name = bySysId.get(parent)?.["name"] ?? "";
      if (name === "" || found.includes(name) || tables.includes(name)) break;
      found.push(name);
      parent = bySysId.get(parent)?.["super_class"] ?? "";
    }
  }
  return found;
}

// Does this record of the signal reach the process? Inactive records don't count.
export function reaches(
  signal: CensusSignal,
  record: CensusRecord,
  tables: readonly string[],
  ancestors: readonly string[],
): boolean {
  if (record.fields["active"] === "false") return false;
  const value = record.fields[signal.field] ?? "";
  if (tables.includes(value)) return true;
  if (!ancestors.includes(value)) return false;
  return signal.inherit === "all" || (signal.inherit === "apps" && record.scope !== PLATFORM_SCOPE);
}

function nameOf(signal: CensusSignal, record: CensusRecord): string {
  for (const field of signal.names) {
    const value = record.fields[field]?.trim();
    if (value !== undefined && value !== "") return value;
  }
  return record.sysId;
}

// The records each signal found, grouped by application, the platform's own first, then the
// applications with the most records.
export function censusOf(
  found: readonly { readonly signal: CensusSignal; readonly records: readonly CensusRecord[] }[],
  titles: ReadonlyMap<string, string>,
): readonly CensusGroup[] {
  const scopes = [...new Set(found.flatMap((item) => item.records.map((record) => record.scope)))];
  const groups = scopes.map((scope): CensusGroup => {
    const items = found.flatMap(({ signal, records }) => {
      const mine = records.filter((record) => record.scope === scope);
      return mine.length === 0
        ? []
        : [
            {
              kind: signal.kind,
              count: mine.length,
              names: [...new Set(mine.map((record) => nameOf(signal, record)))].sort(),
            },
          ];
    });
    const records = items.reduce((sum, item) => sum + item.count, 0);
    const title = scope === PLATFORM_SCOPE ? "Platform (global)" : (titles.get(scope) ?? scope);
    return { scope, title, records, items };
  });
  return groups.sort(
    (left, right) =>
      Number(right.scope === PLATFORM_SCOPE) - Number(left.scope === PLATFORM_SCOPE) ||
      right.records - left.records ||
      left.scope.localeCompare(right.scope),
  );
}
