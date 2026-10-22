import { sha256Hex } from "../../kernel/sha256";

// Ensure rules (ADR-0042): a module states facts about layouts it does not own, found by table
// and view rather than by sys_id, so a plugin that replaces a layout (as KCS for Incident does on
// activation) or another module adding to it changes nothing for the module. Each fact resolved
// on the instance becomes Fluent in the module's build: the container restated by its keys and
// one entry per list the module adds. Pure: the instance's layouts come in as ListState.

export interface EnsureFact {
  readonly capability: string;
  readonly kind: "related_list";
  // The table, the view (its name; the default view is "Default view") and the related list
  // (a reference list "table.field" or a relationship "REL:<sys_id>").
  readonly table: string;
  readonly view: string;
  readonly list: string;
  readonly note: string;
}

// A table's related lists for one view, as the instance holds them now.
export interface ListState {
  // The container (sys_ui_related_list) in the global domain, or null when there is none.
  readonly container: string | null;
  // The view's value on the container (the default view's is "Default view").
  readonly view: string;
  readonly entries: readonly {
    readonly sysId: string;
    readonly relatedList: string;
    readonly position: number;
  }[];
}

// missing: the module adds it; present: already true (someone else's entry); ours: the module's
// entry is there; absent: no list layout for that table and view on the instance.
export type FactStatus = "missing" | "present" | "ours" | "absent";

const text = (entry: Readonly<Record<string, unknown>>, key: string) => {
  const value = entry[key];
  return typeof value === "string" ? value.trim() : "";
};

// The facts in a module's ensure.yaml, naming every entry it cannot use.
export function ensureFactsOf(
  capability: string,
  path: string,
  document: unknown,
  problems: string[],
): EnsureFact[] {
  if (!Array.isArray(document)) {
    problems.push(`${path}: a list of { kind, table, view, list, note }`);
    return [];
  }
  return document.flatMap((item: unknown, index): EnsureFact[] => {
    const entry =
      item !== null && typeof item === "object" ? Object.fromEntries(Object.entries(item)) : {};
    const kind = text(entry, "kind");
    if (kind !== "" && kind !== "related_list") {
      problems.push(`${path}: entry ${index + 1} kind can only be related_list`);
      return [];
    }
    const fact = {
      capability,
      kind: "related_list" as const,
      table: text(entry, "table"),
      view: text(entry, "view"),
      list: text(entry, "list"),
      note: text(entry, "note"),
    };
    if (kind === "" || !fact.table || !fact.view || !fact.list || !fact.note) {
      problems.push(`${path}: entry ${index + 1} needs table, view, list and note`);
      return [];
    }
    return [fact];
  });
}

// The module's entry for a fact: the same sys_id wherever the pack is installed.
export const ensureEntryId = (pack: string, fact: EnsureFact): string =>
  sha256Hex(
    ["ensure", pack, fact.capability, fact.kind, fact.table, fact.view, fact.list].join("/"),
  ).slice(0, 32);

export function factStatus(fact: EnsureFact, state: ListState, ownId: string): FactStatus {
  if (state.container === null) return "absent";
  if (state.entries.some((e) => e.sysId === ownId)) return "ours";
  return state.entries.some((e) => e.relatedList === fact.list) ? "present" : "missing";
}

const quote = (value: string) => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

interface Entry {
  readonly id: string;
  readonly container: string;
  readonly list: string;
  readonly position: number;
}

// The entries the module's build makes: its own where they are, missing ones after the last list.
function entriesOf(pack: string, resolved: readonly { fact: EnsureFact; state: ListState }[]) {
  const next = new Map<string, number>();
  const entries: Entry[] = [];
  const containers = new Map<string, { table: string; view: string }>();
  for (const { fact, state } of resolved) {
    const id = ensureEntryId(pack, fact);
    const status = factStatus(fact, state, id);
    if (state.container === null || (status !== "missing" && status !== "ours")) continue;
    containers.set(state.container, { table: fact.table, view: state.view });
    const own = state.entries.find((e) => e.sysId === id);
    let position = own?.position;
    if (position === undefined) {
      const last =
        next.get(state.container) ?? Math.max(-1, ...state.entries.map((e) => e.position));
      position = last + 1;
      next.set(state.container, position);
    }
    entries.push({ id, container: state.container, list: fact.list, position });
  }
  return { entries, containers };
}

// The generated Fluent for one module's facts, and the containers it adds to (each taken over
// before the push, like an adopted record). Empty when nothing is to be added.
export function ensureSource(
  pack: string,
  module: string,
  resolved: readonly { fact: EnsureFact; state: ListState }[],
): { readonly text: string; readonly containers: readonly string[] } {
  const { entries, containers } = entriesOf(pack, resolved);
  if (entries.length === 0) return { text: "", containers: [] };
  const lines = [
    `// Generated by snagentic accelerator install from modules/${module}/ensure.yaml (ADR-0042): do not edit.`,
    "import { Record } from '@servicenow/sdk/core'",
    "",
  ];
  for (const [container, keys] of containers) {
    lines.push(
      "Record({",
      `    $id: '${container}',`,
      "    table: 'sys_ui_related_list',",
      `    data: { name: ${quote(keys.table)}, view: ${quote(keys.view)} },`,
      "})",
      "",
    );
  }
  for (const entry of entries) {
    lines.push(
      "Record({",
      `    $id: '${entry.id}',`,
      "    table: 'sys_ui_related_list_entry',",
      `    data: { list_id: '${entry.container}', related_list: ${quote(entry.list)}, position: ${entry.position} },`,
      "})",
      "",
    );
  }
  return { text: lines.join("\n"), containers: [...containers.keys()] };
}
