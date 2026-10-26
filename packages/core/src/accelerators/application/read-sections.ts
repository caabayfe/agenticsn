import type { InstanceReader } from "../../connection/ports";
import { TableName } from "../../kernel/table-name";
import { KeysetPager } from "../../sync/application/keyset-pager";
import type { FormFieldFact, SectionElement, SectionState } from "../domain/ensure-form";

// The form sections form_field facts name, read live after the components (a plugin activation
// may replace a form): global domain only (D4), no personal sections, listings through the
// keyset pager (ADR-0016).

const DEFAULT_VIEW = "Default view";

async function viewId(reader: InstanceReader, view: string, signal: AbortSignal) {
  if (view === DEFAULT_VIEW) return DEFAULT_VIEW;
  const rows = await reader.query(
    { table: TableName.parse("sys_ui_view"), query: `name=${view}`, fields: ["sys_id"], limit: 1 },
    signal,
  );
  return rows[0]?.["sys_id"] ?? null;
}

async function sectionsOf(
  reader: InstanceReader,
  table: string,
  view: string,
  signal: AbortSignal,
): Promise<Readonly<Record<string, string>>[]> {
  const rows: Readonly<Record<string, string>>[] = [];
  const listing = {
    kind: "snapshot" as const,
    table: TableName.parse("sys_ui_section"),
    base: `name=${table}^view=${view}^sys_domain=global^sys_userISEMPTY`,
    fields: ["sys_id", "caption", "title", "header", "sys_scope", "sys_scope.scope"],
  };
  for await (const row of new KeysetPager(reader).rows(listing, signal)) rows.push(row);
  return rows;
}

async function elementsOf(
  reader: InstanceReader,
  sections: readonly string[],
  signal: AbortSignal,
): Promise<(SectionElement & { readonly section: string })[]> {
  if (sections.length === 0) return [];
  const elements: (SectionElement & { readonly section: string })[] = [];
  const listing = {
    kind: "snapshot" as const,
    table: TableName.parse("sys_ui_element"),
    base: `sys_ui_sectionIN${sections.join(",")}`,
    fields: ["sys_id", "sys_ui_section", "element", "type", "sys_ui_formatter", "position"],
  };
  for await (const row of new KeysetPager(reader).rows(listing, signal)) {
    elements.push({
      section: row["sys_ui_section"] ?? "",
      sysId: row["sys_id"] ?? "",
      element: row["element"] ?? "",
      type: row["type"] ?? "",
      formatter: row["sys_ui_formatter"] ?? "",
      position: Number(row["position"] ?? 0),
    });
  }
  return elements;
}

async function sectionOf(
  reader: InstanceReader,
  fact: FormFieldFact,
  signal: AbortSignal,
): Promise<SectionState> {
  const none: SectionState = {
    sysId: null,
    scope: { name: "global", sysId: "global" },
    table: fact.table,
    view: fact.view,
    caption: fact.section,
    title: "",
    header: "",
    elements: [],
    onView: [],
  };
  const view = await viewId(reader, fact.view, signal);
  if (view === null) return none;
  const sections = await sectionsOf(reader, fact.table, view, signal);
  const section = sections.find((s) => (s["caption"] ?? "") === fact.section);
  if (section === undefined) return none;
  const elements = await elementsOf(
    reader,
    sections.map((s) => s["sys_id"] ?? ""),
    signal,
  );
  const sysId = section["sys_id"] ?? "";
  const scopeId = section["sys_scope"] ?? "global";
  return {
    ...none,
    sysId,
    scope: { name: section["sys_scope.scope"] || scopeId, sysId: scopeId },
    title: section["title"] ?? "",
    header: section["header"] ?? "",
    elements: elements
      .filter((e) => e.section === sysId)
      .map(({ section: _, ...element }) => element),
    onView: [...new Set(elements.map((e) => e.element))],
  };
}

// The sections the facts name, one per fact in order.
export async function readSections(
  reader: InstanceReader,
  facts: readonly FormFieldFact[],
  signal: AbortSignal,
): Promise<SectionState[]> {
  const states: SectionState[] = [];
  for (const fact of facts) states.push(await sectionOf(reader, fact, signal));
  return states;
}
