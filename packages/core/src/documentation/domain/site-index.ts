import { type ConfigIndex, groupByType, type IndexEntry } from "./config-index";
import { escapeHtml } from "./html";
import type { Process } from "./process";
import { type Built, checked, guideCrumbs, link, SECTION_TITLES } from "./site-context";
import { layout, prefixOf, sectionHome } from "./site-layout";

export function recordsFile(process: string): string {
  return `processes/${process}/configure/records.html`;
}

function row(record: IndexEntry, prefix: string): string {
  const pages = record.citedBy.map((page) => link(prefix, page.file, page.title)).join("<br>");
  const status =
    record.status === null
      ? ""
      : `<span class="status status-${record.status}">${record.status}</span>`;
  return (
    `<tr><td>${escapeHtml(record.name)}<br><code>${escapeHtml(`${record.table}/${record.sysId}`)}</code></td>` +
    `<td>${escapeHtml(record.details.join(", "))}</td>` +
    `<td>${record.citedBy.length === 0 ? escapeHtml(record.updated ?? "") : pages}</td><td>${status}</td></tr>`
  );
}

function groups(records: readonly IndexEntry[], prefix: string, last: string): string {
  return groupByType(records)
    .map(
      (group) =>
        `<h3>${escapeHtml(group.title)} (${group.records.length})</h3>` +
        `<table><thead><tr><th>Record</th><th>Runs</th><th>${last}</th><th>Status</th></tr></thead>` +
        `<tbody>${group.records.map((record) => row(record, prefix)).join("")}</tbody></table>`,
    )
    .join("");
}

// Every record the process's pages cite, by type, and the active records on its tables that no
// page cites: what the documentation doesn't cover yet.
export function recordsHtml(b: Built, process: Process, index: ConfigIndex): string {
  const file = recordsFile(process.id);
  const prefix = prefixOf(file);
  const tables = process.tables.map((table) => `<code>${escapeHtml(table)}</code>`).join(", ");
  const uncited =
    process.tables.length === 0
      ? ""
      : `<h2>Not documented yet (${index.uncited.length})</h2>
<p>Active records on ${tables} that no page cites. Each is either worth a sentence on a configure page, or worth asking about.</p>
${groups(index.uncited, prefix, "Last changed")}`;
  const main = `<h1>${escapeHtml(process.title)}: configuration index</h1>
<div class="banner"><span class="kind">Technical reference</span><span>${checked(b)}</span></div>
<h2>Documented (${index.cited.length})</h2>
${groups(index.cited, prefix, "Cited by")}
${uncited}`;
  return layout(
    b.input.config,
    `${process.title}: configuration index`,
    file,
    [
      ...guideCrumbs(b, "platform"),
      { href: `processes/${process.id}/index.html`, text: process.title },
      { href: sectionHome(process.id, "configure"), text: SECTION_TITLES.configure },
    ],
    main,
  );
}
