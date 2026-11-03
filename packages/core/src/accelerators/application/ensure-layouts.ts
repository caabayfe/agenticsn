import type { InstanceReader } from "../../connection/ports";
import { TableName } from "../../kernel/table-name";
import { KeysetPager } from "../../sync/application/keyset-pager";
import {
  type EnsureFact,
  ensureSource,
  isFormFieldFact,
  isListFact,
  type ListFact,
  type ListState,
} from "../domain/ensure";
import type { Adoption } from "../domain/materialize";
import type { InstallSteps } from "../ports";
import { ensureForms, type FormDelivery } from "./ensure-forms";

// Ensure rules at install time (ADR-0042): the layouts a module adds to are read live, after any
// plugin activation, and its lists to add are generated as Fluent in the module's build.

// The default view's value on a container; any other view by its name.
const DEFAULT_VIEW = "Default view";

async function viewId(reader: InstanceReader, view: string, signal: AbortSignal) {
  if (view === DEFAULT_VIEW) return DEFAULT_VIEW;
  const rows = await reader.query(
    { table: TableName.parse("sys_ui_view"), query: `name=${view}`, fields: ["sys_id"], limit: 1 },
    signal,
  );
  return rows[0]?.["sys_id"] ?? null;
}

// One fact's layout: the table's related-list container for the view, in the global domain, and
// its entries (read through the keyset pager, ADR-0016).
async function layoutOf(
  reader: InstanceReader,
  fact: ListFact,
  signal: AbortSignal,
): Promise<ListState> {
  const view = await viewId(reader, fact.view, signal);
  const none = { container: null, view: view ?? fact.view, entries: [] };
  if (view === null) return none;
  const lists = await reader.query(
    {
      table: TableName.parse("sys_ui_related_list"),
      query: `name=${fact.table}^view=${view}^sys_domain=global`,
      fields: ["sys_id"],
      limit: 1,
    },
    signal,
  );
  const container = lists[0]?.["sys_id"];
  if (container === undefined) return none;
  const entries: { sysId: string; relatedList: string; position: number }[] = [];
  const listing = {
    kind: "snapshot" as const,
    table: TableName.parse("sys_ui_related_list_entry"),
    base: `list_id=${container}`,
    fields: ["sys_id", "related_list", "position"],
  };
  for await (const row of new KeysetPager(reader).rows(listing, signal)) {
    entries.push({
      sysId: row["sys_id"] ?? "",
      relatedList: row["related_list"] ?? "",
      position: Number(row["position"] ?? 0),
    });
  }
  return { container, view, entries };
}

// The layouts the facts name, one per fact in order.
export async function readLayouts(
  reader: InstanceReader,
  facts: readonly ListFact[],
  signal: AbortSignal,
): Promise<ListState[]> {
  const states: ListState[] = [];
  for (const fact of facts) states.push(await layoutOf(reader, fact, signal));
  return states;
}

type EnsureSteps = Pick<
  InstallSteps,
  "layouts" | "sections" | "project" | "writeFile" | "readFile" | "removeFile" | "commit"
>;

// The layouts and forms the modules add to (ADR-0042): related lists, then form fields.
export async function ensureLayouts(
  deps: { readonly steps: EnsureSteps },
  pack: string,
  facts: readonly EnsureFact[],
  delivery: FormDelivery,
  signal: AbortSignal,
): Promise<{ readonly adoptions: Adoption[]; readonly written: readonly string[] }> {
  const lists = await ensureLists(deps, pack, facts.filter(isListFact), signal);
  const forms = await ensureForms(deps, pack, facts.filter(isFormFieldFact), delivery, signal);
  return {
    adoptions: [...lists.adoptions, ...forms.adoptions],
    written: [...lists.written, ...forms.written],
  };
}

type ListSteps = Pick<InstallSteps, "layouts" | "writeFile" | "readFile" | "removeFile" | "commit">;

// The related lists the modules add to: each fact read live after the components, so a plugin
// that replaced a layout is found by table and view; the lists to add become a generated Fluent
// file per module, committed. The container is never in the build: SDK 4.14 would write it with
// the build's entries as one update that replaces the whole layout (ADR-0046).
async function ensureLists(
  deps: { readonly steps: ListSteps },
  pack: string,
  facts: readonly ListFact[],
  signal: AbortSignal,
): Promise<{ readonly adoptions: Adoption[]; readonly written: readonly string[] }> {
  if (facts.length === 0) return { adoptions: [], written: [] };
  const states = await deps.steps.layouts(facts, signal);
  const resolved = facts.flatMap((fact, i) => {
    const state = states[i];
    return state === undefined ? [] : [{ fact, state }];
  });
  const written: string[] = [];
  for (const module of [...new Set(facts.map((f) => f.capability))]) {
    const source = ensureSource(
      pack,
      module,
      resolved.filter((r) => r.fact.capability === module),
    );
    if (source.text === "") continue;
    const path = `source/global/src/fluent/ensure-${module}.now.ts`;
    await deps.steps.writeFile(path, source.text);
    written.push(path);
  }
  const removed = await removeContainerFiles(deps, states);
  if (written.length + removed.length > 0) {
    await deps.steps.commit(
      [...written, ...removed],
      "chore(snagentic): the layouts the accelerator adds to",
    );
  }
  return { adoptions: [], written };
}

// The container files snagentic 2.15 and earlier generated beside the entries, for the layouts
// these facts resolved to.
async function removeContainerFiles(
  deps: { readonly steps: Pick<ListSteps, "readFile" | "removeFile"> },
  states: readonly ListState[],
): Promise<string[]> {
  const removed: string[] = [];
  for (const container of new Set(states.flatMap((s) => s.container ?? []))) {
    const path = `source/global/src/fluent/ensure-list-${container}.now.ts`;
    if ((await deps.steps.readFile(path)) === null) continue;
    await deps.steps.removeFile(path);
    removed.push(path);
  }
  return removed;
}
