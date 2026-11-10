// Writes the index table of docs/adr/README.md from each record's title and status line
// (bun run docs). The records are the source; the index only summarizes them.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface AdrEntry {
  readonly number: string;
  readonly file: string;
  readonly title: string;
  // The status word and any qualifier before its details, for example "Superseded by 0031".
  readonly status: string;
  // Records the status line names as amending this one, and dates of amendments made in place.
  readonly amendedBy: readonly string[];
  readonly amendedOn: readonly string[];
  // Records this one amends, from its `Amends` field.
  readonly amends: readonly string[];
}

const START = "<!-- adr-index:start -->";
const END = "<!-- adr-index:end -->";
// An ADR number: four digits starting with 0, not part of a date or a longer number.
const ADR_NUMBER = /(?<![\d-])0\d{3}(?![\d-])/g;

// A header field's text: its first line and the indented lines that continue it.
function field(lines: readonly string[], name: RegExp): string {
  const start = lines.findIndex((line) => name.test(line));
  if (start < 0) {
    return "";
  }
  const continued = lines.slice(start + 1).findIndex((line) => !/^\s+\S/.test(line));
  const end = continued < 0 ? lines.length : start + 1 + continued;
  return lines.slice(start, end).join(" ");
}

export function parseAdr(file: string, text: string): AdrEntry {
  const lines = text.split("\n");
  const heading = /^# (\d{4})\. (.+)$/.exec(lines[0] ?? "");
  if (heading === null) {
    throw new Error(`${file}: the first line must be "# NNNN. Title"`);
  }
  const status = field(lines, /^- Status: /).replace(/^- Status: /, "");
  return {
    number: heading[1] ?? "",
    file,
    title: heading[2] ?? "",
    status: (/^[^(;.:]+/.exec(status)?.[0] ?? status).trim(),
    amendedBy: [...status.matchAll(/amended by (?:ADR-)?(0\d{3})/gi)].map((m) => m[1] ?? ""),
    amendedOn: [...status.matchAll(/amended (\d{4}-\d{2}-\d{2})/gi)].map((m) => m[1] ?? ""),
    amends: field(lines, /^- Amends(, when accepted)?:/).match(ADR_NUMBER) ?? [],
  };
}

export function readAdrs(dir: string): AdrEntry[] {
  return readdirSync(dir)
    .filter((name) => /^\d{4}-.+\.md$/.test(name))
    .sort()
    .map((name) => parseAdr(name, readFileSync(join(dir, name), "utf8")));
}

function statusCell(entry: AdrEntry, entries: readonly AdrEntry[]): string {
  if (entry.status.startsWith("Superseded")) {
    return entry.status;
  }
  // A proposal amends nothing until it is accepted.
  const amenders = entries
    .filter((other) => !other.status.startsWith("Proposed") && other.amends.includes(entry.number))
    .map((other) => other.number);
  const by = [...new Set([...entry.amendedBy, ...amenders])].sort();
  const notes = [
    ...entry.amendedOn.map((date) => `amended ${date}`),
    ...(by.length > 0 ? [`amended by ${by.join(", ")}`] : []),
  ];
  return notes.length > 0 ? `${entry.status} (${notes.join("; ")})` : entry.status;
}

export function adrIndexTable(entries: readonly AdrEntry[]): string {
  const rows = entries.map(
    (entry) =>
      `| [${entry.number}](${entry.file}) | ${entry.title} | ${statusCell(entry, entries)} |`,
  );
  return `${["| ADR | Title | Status |", "|---|---|---|", ...rows].join("\n")}\n`;
}

// The README with the text between the index markers replaced; the prose around them stays.
export function withAdrIndex(readme: string, table: string): string {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start < 0 || end < start) {
    throw new Error(`docs/adr/README.md needs the markers ${START} and ${END}`);
  }
  return `${readme.slice(0, start + START.length)}\n${table}${readme.slice(end)}`;
}

if (import.meta.main) {
  const path = "docs/adr/README.md";
  const readme = readFileSync(path, "utf8");
  writeFileSync(path, withAdrIndex(readme, adrIndexTable(readAdrs("docs/adr"))));
  console.log(`wrote ${path}`);
}
