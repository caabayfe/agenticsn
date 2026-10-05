export interface RecordFiles {
  readonly leaf: string;
  readonly yaml: string;
  readonly files: readonly { readonly field: string; readonly name: string }[];
  readonly children: readonly { readonly table: string; readonly name: string }[];
}

interface Group {
  yaml?: string;
  files: { field: string; name: string }[];
  children: { table: string; name: string }[];
}

const FIELD_FILE = /^([a-z0-9_$]+)\.[a-z0-9]+$/;
const CHILD_FILE = /^children\.([a-z0-9_$]+)\.yaml$/;

// Groups a class folder's file names by record (ADR-0017). Record leaves contain no dots:
//   <leaf>.yaml, <leaf>.<field>.<ext>, <leaf>.children.<table>.yaml
// Files that belong to no record YAML are ignored.
export function groupRecordFiles(names: readonly string[]): ReadonlyMap<string, RecordFiles> {
  const groups = new Map<string, Group>();
  for (const name of names) {
    const dot = name.indexOf(".");
    if (dot <= 0) {
      continue;
    }
    const leaf = name.slice(0, dot);
    const rest = name.slice(dot + 1);
    const group = groups.get(leaf) ?? { files: [], children: [] };
    groups.set(leaf, group);
    const child = CHILD_FILE.exec(rest);
    const field = FIELD_FILE.exec(rest);
    if (rest === "yaml") {
      group.yaml = name;
    } else if (child?.[1] !== undefined) {
      group.children.push({ table: child[1], name });
    } else if (field?.[1] !== undefined) {
      group.files.push({ field: field[1], name });
    }
  }
  const records = new Map<string, RecordFiles>();
  for (const [leaf, group] of groups) {
    if (group.yaml !== undefined) {
      records.set(leaf, { leaf, yaml: group.yaml, files: group.files, children: group.children });
    }
  }
  return records;
}
