import { sha256Hex } from "../../kernel/sha256";
import { type FormFieldFact, formFieldFactOf } from "./ensure-form";

// Ensure rules (ADR-0042): a module states facts about layouts it does not own, found by table
// and view rather than by sys_id, so a plugin that replaces a layout (as KCS for Incident does on
// activation) or another module adding to it changes nothing for the module. Each fact resolved
// on the instance becomes Fluent in the module's build: the container restated by its keys and
// one entry per list the module adds. Pure: the instance's layouts come in as ListState.

export interface ListFact {
  readonly capability: string;
  readonly kind: "related_list";
  // The table, the view (its name; the default view is "Default view") and the related list
  // (a reference list "table.field" or a relationship "REL:<sys_id>").
  readonly table: string;
  readonly view: string;
  readonly list: string;
  readonly note: string;
  // The entry's sys_id when the module gave it one before (a list it added from its source, now
  // moved to ensure.yaml): kept, so nothing is deleted or created again. Otherwise derived.
  readonly id?: string;
}

// A fact of either kind: a related list on a layout, or a field on a form section.
export type EnsureFact = ListFact | FormFieldFact;

export const isListFact = (fact: EnsureFact): fact is ListFact => fact.kind === "related_list";
export const isFormFieldFact = (fact: EnsureFact): fact is FormFieldFact =>
  fact.kind === "form_field";

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

const SYS_ID = /^[0-9a-f]{32}$/;

const text = (entry: Readonly<Record<string, unknown>>, key: string) => {
  const value = entry[key];
  return typeof value === "string" ? value.trim() : "";
};

// A related_list entry, or null with its problem named.
function listFactOf(
  capability: string,
  where: string,
  entry: Readonly<Record<string, unknown>>,
  problems: string[],
): ListFact | null {
  const fact = {
    capability,
    kind: "related_list" as const,
    table: text(entry, "table"),
    view: text(entry, "view"),
    list: text(entry, "list"),
    note: text(entry, "note"),
  };
  if (!fact.table || !fact.view || !fact.list || !fact.note) {
    problems.push(`${where} needs table, view, list and note`);
    return null;
  }
  const id = text(entry, "id");
  if (id === "") return fact;
  if (!SYS_ID.test(id)) {
    problems.push(`${where} id must be a sys_id (32 hexadecimal characters)`);
    return null;
  }
  return { ...fact, id };
}

type FactParser = (
  capability: string,
  where: string,
  entry: Readonly<Record<string, unknown>>,
  problems: string[],
) => EnsureFact | null;

// A Map, so a kind such as "constructor" names no parser.
const PARSERS: ReadonlyMap<string, FactParser> = new Map<string, FactParser>([
  ["related_list", listFactOf],
  ["form_field", formFieldFactOf],
]);

// The facts in a module's ensure.yaml, naming every entry it cannot use.
export function ensureFactsOf(
  capability: string,
  path: string,
  document: unknown,
  problems: string[],
): EnsureFact[] {
  if (!Array.isArray(document)) {
    problems.push(`${path}: a list of { kind, table, view, list or field, note }`);
    return [];
  }
  return document.flatMap((item: unknown, index): EnsureFact[] => {
    const entry =
      item !== null && typeof item === "object" ? Object.fromEntries(Object.entries(item)) : {};
    const where = `${path}: entry ${index + 1}`;
    const parse = PARSERS.get(text(entry, "kind"));
    if (parse === undefined) {
      problems.push(
        text(entry, "kind") === ""
          ? `${where} needs table, view, list and note`
          : `${where} kind can only be related_list or form_field`,
      );
      return [];
    }
    const fact = parse(capability, where, entry, problems);
    return fact === null ? [] : [fact];
  });
}

// The module's entry for a fact: the same sys_id wherever the pack is installed.
export const ensureEntryId = (pack: string, fact: ListFact): string =>
  fact.id ??
  sha256Hex(
    ["ensure", pack, fact.capability, fact.kind, fact.table, fact.view, fact.list].join("/"),
  ).slice(0, 32);

export function factStatus(fact: ListFact, state: ListState, ownId: string): FactStatus {
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

// A container a module adds to, by its keys.
export interface EnsureContainer {
  readonly sysId: string;
  readonly table: string;
  readonly view: string;
}

// The entries the module's build makes: its own where they are, missing ones after the last list.
function entriesOf(pack: string, resolved: readonly { fact: ListFact; state: ListState }[]) {
  const next = new Map<string, number>();
  const entries: Entry[] = [];
  const containers = new Map<string, EnsureContainer>();
  for (const { fact, state } of resolved) {
    const id = ensureEntryId(pack, fact);
    const status = factStatus(fact, state, id);
    if (state.container === null || (status !== "missing" && status !== "ours")) continue;
    containers.set(state.container, {
      sysId: state.container,
      table: fact.table,
      view: state.view,
    });
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

const HEADER = "import { Record } from '@servicenow/sdk/core'";

// The generated Fluent for one module's facts: its entries only, and the containers they go in
// (each restated in its own source, ensureContainerSource, since several modules may add to one
// layout and a record is declared once; each is taken over before the push, like an adopted
// record). Empty when nothing is to be added.
export function ensureSource(
  pack: string,
  module: string,
  resolved: readonly { fact: ListFact; state: ListState }[],
): { readonly text: string; readonly containers: readonly EnsureContainer[] } {
  const { entries, containers } = entriesOf(pack, resolved);
  if (entries.length === 0) return { text: "", containers: [] };
  const lines = [
    `// Generated by snagentic accelerator install from modules/${module}/ensure.yaml (ADR-0042): do not edit.`,
    HEADER,
    "",
  ];
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
  return { text: lines.join("\n"), containers: [...containers.values()] };
}

// A container restated by its keys, the same text whichever module needs it.
export function ensureContainerSource(container: EnsureContainer): string {
  return [
    `// Generated by snagentic accelerator install: the related lists of ${container.table}, ${container.view}, which modules add to (ADR-0042): do not edit.`,
    HEADER,
    "",
    "Record({",
    `    $id: '${container.sysId}',`,
    "    table: 'sys_ui_related_list',",
    `    data: { name: ${quote(container.table)}, view: ${quote(container.view)} },`,
    "})",
    "",
  ].join("\n");
}
