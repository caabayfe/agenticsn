import type { EvidenceStatus } from "./evidence";

// The configuration types the index groups records by, in the order a platform team reads them,
// and the field that names the table a record applies to (spec 010a §2, Configure).
export interface ConfigRecordType {
  readonly table: string;
  readonly title: string;
  readonly tableField: string;
  // ACL names are <table> or <table>.<field>.
  readonly prefix?: boolean;
}

export const CONFIG_RECORD_TYPES: readonly ConfigRecordType[] = [
  { table: "sys_script", title: "Business rules", tableField: "collection" },
  { table: "sys_security_acl", title: "Access controls", tableField: "name", prefix: true },
  { table: "sys_script_client", title: "Client scripts", tableField: "table" },
  { table: "sys_ui_policy", title: "UI policies", tableField: "table" },
  { table: "sys_data_policy2", title: "Data policies", tableField: "model_table" },
  { table: "sys_ui_action", title: "UI actions", tableField: "table" },
  { table: "sys_declarative_action_assignment", title: "Workspace actions", tableField: "table" },
  { table: "sys_ux_list", title: "Workspace lists", tableField: "table" },
  { table: "sysevent_email_action", title: "Notifications", tableField: "collection" },
  { table: "contract_sla", title: "SLA definitions", tableField: "collection" },
];

const OTHER = "Other records";

export function typeTitle(table: string): string {
  return CONFIG_RECORD_TYPES.find((type) => type.table === table)?.title ?? OTHER;
}

const NAME_FIELDS = ["name", "label", "title", "short_description", "sys_name", "question_text"];

export function recordName(fields: Readonly<Record<string, string>>): string {
  for (const name of NAME_FIELDS) {
    const value = fields[name]?.trim();
    if (value !== undefined && value !== "") {
      return value;
    }
  }
  return "(no name)";
}

const DETAIL_FIELDS: readonly (readonly [string, string])[] = [
  ["when", "when"],
  ["order", "order"],
  ["operation", "operation"],
  ["type", "type"],
  ["action_name", "action"],
  ["event_name", "event"],
];

// What a platform team scans first: when it runs, its order, and whether it is off.
export function recordDetails(fields: Readonly<Record<string, string>>): readonly string[] {
  const details = DETAIL_FIELDS.flatMap(([field, label]) => {
    const value = fields[field]?.trim();
    return value === undefined || value === "" ? [] : [`${label} ${value}`];
  });
  return fields["active"] === "false" ? ["inactive", ...details] : details;
}

// Does a record of this type apply to one of the process's tables?
export function appliesTo(
  type: ConfigRecordType,
  fields: Readonly<Record<string, string>>,
  tables: readonly string[],
): boolean {
  const value = fields[type.tableField] ?? "";
  return tables.some((table) =>
    type.prefix === true ? value === table || value.startsWith(`${table}.`) : value === table,
  );
}

export interface CitingPage {
  // Relative to the site root.
  readonly file: string;
  readonly title: string;
}

export interface IndexEntry {
  readonly table: string;
  readonly sysId: string;
  readonly name: string;
  readonly details: readonly string[];
  readonly citedBy: readonly CitingPage[];
  // The worst status of the evidence citing it; null for an uncited record.
  readonly status: EvidenceStatus | null;
  // Uncited records: who changed it last, and when.
  readonly updated?: string;
}

export interface ConfigIndex {
  readonly cited: readonly IndexEntry[];
  readonly uncited: readonly IndexEntry[];
}

const WORST: readonly EvidenceStatus[] = [
  "missing",
  "changed",
  "unpinned",
  "recheck",
  "seen",
  "fresh",
];

export function worstStatus(statuses: readonly EvidenceStatus[]): EvidenceStatus | null {
  return WORST.find((status) => statuses.includes(status)) ?? null;
}

// Records grouped by type, in CONFIG_RECORD_TYPES order and then "Other records", each group by name.
export function groupByType(
  records: readonly IndexEntry[],
): readonly { readonly title: string; readonly records: readonly IndexEntry[] }[] {
  const titles = [...CONFIG_RECORD_TYPES.map((type) => type.title), OTHER];
  return titles.flatMap((title) => {
    const mine = records
      .filter((record) => typeTitle(record.table) === title)
      .sort((left, right) => left.name.localeCompare(right.name));
    return mine.length === 0 ? [] : [{ title, records: mine }];
  });
}
