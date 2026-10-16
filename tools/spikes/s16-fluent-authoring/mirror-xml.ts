// Spike S16 (spec 008, F1): render a scope's mirrored records as the update XML the platform
// records, with the product's own writers, so the SDK's offline transform can read them. Not
// product code.
//   bun mirror-xml.ts <metadata dir> <scope> <out dir>
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "../../../packages/cli/node_modules/yaml";
import { groupRecordFiles } from "../../../packages/cli/src/adapters/records/record-files";
import { layoutKindOf } from "../../../packages/core/src/delivery/domain/layout-kinds";
import {
  layoutUpdateName,
  layoutXml,
} from "../../../packages/core/src/delivery/domain/layout-render";
import { DEFAULT_VIEW } from "../../../packages/core/src/delivery/domain/layout-xml";
import type { PlannedLayout, Row } from "../../../packages/core/src/delivery/domain/planned-layout";
import { recordUpdateXml } from "../../../packages/core/src/delivery/domain/record-update";
import { parseRecord } from "../../../packages/core/src/metadata/domain/record-layout";

const [metadata = "", scope = "", out = ""] = process.argv.slice(2);

export interface MirrorRecord {
  readonly base: string;
  readonly table: string;
  readonly sysId: string;
  readonly domain: string;
  readonly scopeId: string;
  readonly fields: Record<string, string>;
  readonly children: Record<string, Row[]>;
}

function classFolders(root: string, scopeName: string): string[] {
  const folders: string[] = [];
  const scoped = join(root, scopeName);
  if (statSync(scoped, { throwIfNoEntry: false })?.isDirectory()) folders.push(scoped);
  const domains = join(root, "domains");
  for (const d of statSync(domains, { throwIfNoEntry: false }) ? readdirSync(domains) : []) {
    const f = join(domains, d, scopeName);
    if (statSync(f, { throwIfNoEntry: false })?.isDirectory()) folders.push(f);
  }
  return folders.flatMap((f) => readdirSync(f).map((c) => join(f, c)));
}

export function mirrorRecords(root: string, scopeName: string): MirrorRecord[] {
  const records: MirrorRecord[] = [];
  for (const folder of classFolders(root, scopeName)) {
    for (const group of groupRecordFiles(readdirSync(folder)).values()) {
      const document = parse(readFileSync(join(folder, group.yaml), "utf8"));
      const files = group.files.map((f) => ({
        field: f.field,
        content: readFileSync(join(folder, f.name), "utf8"),
      }));
      const { artifact } = parseRecord(document, files);
      const children: Record<string, Row[]> = {};
      for (const child of group.children) {
        const rows: unknown = parse(readFileSync(join(folder, child.name), "utf8"));
        children[child.table] = (Array.isArray(rows) ? rows : []).map((row: object) =>
          Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v ?? "")])),
        );
      }
      records.push({
        base: relative(root, join(folder, group.leaf)),
        table: artifact.identity.className,
        sysId: artifact.identity.sysId,
        domain: artifact.identity.domain,
        scopeId: artifact.meta["sys_scope"] ?? "",
        fields: { ...artifact.fields },
        children,
      });
    }
  }
  return records;
}

const byPosition = (a: Row, b: Row) => Number(a["position"] ?? 0) - Number(b["position"] ?? 0);

function layoutOf(record: MirrorRecord, all: readonly MirrorRecord[]): PlannedLayout | null {
  const spec = layoutKindOf(record.table);
  if (spec === undefined) return null;
  const viewName = record.fields["view"] ?? "";
  const view =
    viewName === "" || viewName === DEFAULT_VIEW
      ? { sysId: DEFAULT_VIEW, name: "" }
      : { sysId: viewName, name: viewName };
  const rows = [...(record.children[spec.rows] ?? [])].sort(byPosition);
  const sections: PlannedLayout["sections"] = Object.fromEntries(
    rows.flatMap((row) => {
      const section = all.find((r) => r.sysId === row["sys_ui_section"]);
      return section === undefined
        ? []
        : [
            [
              section.sysId,
              {
                caption: section.fields["caption"] ?? "",
                domain: section.domain,
                viewSysId: section.fields["view"] || DEFAULT_VIEW,
              },
            ],
          ];
    }),
  );
  const layout = {
    kind: spec.kind,
    operation: "create" as const,
    path: `${record.base}.yaml`,
    scope,
    sysId: record.sysId,
    table: record.fields["name"] ?? "",
    view,
    domain: record.domain,
    fields: record.fields,
    rows,
    sections,
    base: null,
  };
  return { ...layout, updateName: layoutUpdateName(layout) };
}

if (import.meta.main) {
  const records = mirrorRecords(metadata, scope);
  mkdirSync(out, { recursive: true });
  let written = 0;
  for (const record of records) {
    const scopeRef = { name: scope, sysId: record.scopeId };
    const layout = layoutOf(record, records);
    const files: [string, string][] = [];
    if (layout !== null) {
      files.push([`${layout.updateName}.xml`, layoutXml(layout, scopeRef)]);
    } else {
      const fields =
        record.domain === "global"
          ? record.fields
          : { ...record.fields, sys_domain: record.domain };
      files.push([
        `${record.table}_${record.sysId}.xml`,
        recordUpdateXml({ table: record.table, sysId: record.sysId, fields }, scopeRef),
      ]);
      // Child rows the layouts don't carry (choices): one update each.
      for (const [table, rows] of Object.entries(record.children)) {
        for (const row of rows) {
          const { sys_id = "", ...rowFields } = row;
          files.push([
            `${table}_${sys_id}.xml`,
            recordUpdateXml({ table, sysId: sys_id, fields: rowFields }, scopeRef),
          ]);
        }
      }
    }
    for (const [name, xml] of files) {
      writeFileSync(join(out, name), xml);
      written++;
    }
  }
  console.log(`${records.length} records, ${written} update files in ${out}`);
}
