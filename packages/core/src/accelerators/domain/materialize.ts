// What adding a pack's capabilities writes into the workspace (ADR-0026 as amended by ADR-0031):
// the pack's Fluent source copied into the workspace's projects, and the out-of-box records it
// customizes listed for the user to adopt and edit. Pure: files come in as text, YAML parsed by
// the caller.

export interface MaterializedFile {
  // Workspace-relative: source/<scope>/...
  readonly path: string;
  readonly text: string;
  readonly capability: string;
}

// An out-of-box record a capability customizes: adopted into source, then edited as the note says.
export interface Adoption {
  readonly capability: string;
  readonly table: string;
  readonly sysId: string;
  readonly note: string;
}

export interface MaterializeInput {
  // Capability ids, dependencies first.
  readonly selected: readonly string[];
  // The pack's files, by path in the pack.
  readonly files: ReadonlyMap<string, string>;
  // An adopt file's text, parsed (YAML).
  readonly parse: (text: string) => unknown;
}

export interface Materialized {
  readonly files: readonly MaterializedFile[];
  readonly adoptions: readonly Adoption[];
  readonly problems: readonly string[];
}

const IGNORED = (path: string) => path === "accelerator.yaml" || path.startsWith("data/");
const FORMAT_1 = (path: string) => path.startsWith("metadata/") || path.startsWith("patches/");
const ADOPT_FILE = /^adopt\/([^/]+)\.yaml$/;
const SYS_ID = /^[0-9a-f]{32}$/;

// The capability a pack file belongs to: source/<capability>/... or adopt/<capability>.yaml.
export function capabilityOf(path: string): string | null {
  const adopt = ADOPT_FILE.exec(path);
  if (adopt !== null) return adopt[1] ?? null;
  const [top, capability, ...rest] = path.split("/");
  return top === "source" && capability !== undefined && rest.length > 0 ? capability : null;
}

// The workspace path a source file is copied to, or null when it is not inside a project folder.
export function workspacePathOf(path: string): string | null {
  const [top, , scope, ...rest] = path.split("/");
  if (top !== "source" || scope === undefined || rest.length === 0) return null;
  return ["source", scope, ...rest].join("/");
}

// Pack files that are neither content nor the manifest and data templates. A pack still in the
// YAML layout of format 1 is named once: every one of its files has the same remedy.
function layoutProblems(files: ReadonlyMap<string, string>): string[] {
  const paths = [...files.keys()].filter((path) => !IGNORED(path));
  const old = paths.filter(FORMAT_1).sort();
  const problems = paths
    .filter((path) => !FORMAT_1(path) && capabilityOf(path) === null)
    .map((path) => `${path}: not under source/<capability>/<scope>/ or adopt/<capability>.yaml`);
  if (old.length > 0) {
    const more = old.length > 1 ? ` and ${old.length - 1} more` : "";
    problems.push(
      `${old[0]}${more}: pack format 1: YAML records and patches are no longer installed; ship Fluent under source/ and customizations under adopt/`,
    );
  }
  return problems;
}

const text = (entry: Readonly<Record<string, unknown>>, key: string) => {
  const value = entry[key];
  return typeof value === "string" ? value.trim() : "";
};

function adoptionsOf(capability: string, path: string, document: unknown, problems: string[]) {
  if (!Array.isArray(document)) {
    problems.push(`${path}: a list of { table, sys_id, note }`);
    return [];
  }
  return document.flatMap((item: unknown, index): Adoption[] => {
    const entry =
      item !== null && typeof item === "object" ? Object.fromEntries(Object.entries(item)) : {};
    const adoption = {
      capability,
      table: text(entry, "table"),
      sysId: text(entry, "sys_id"),
      note: text(entry, "note"),
    };
    if (adoption.table !== "" && SYS_ID.test(adoption.sysId) && adoption.note !== "") {
      return [adoption];
    }
    problems.push(
      `${path}: entry ${index + 1} needs table, sys_id (32 hexadecimal characters) and note`,
    );
    return [];
  });
}

// A source file's copy, unless another capability already writes that path.
function copyOf(
  file: MaterializedFile,
  writer: Map<string, MaterializedFile>,
  problems: string[],
): MaterializedFile[] {
  const first = writer.get(file.path);
  if (first === undefined) {
    writer.set(file.path, file);
    return [file];
  }
  // Two capabilities may ship the same project file (its now.config.json) word for word.
  if (first.text !== file.text) {
    problems.push(`${file.path} is written by both ${first.capability} and ${file.capability}`);
  }
  return [];
}

// The files and adoptions a selection writes, and every problem that stops it.
export function materialize(input: MaterializeInput): Materialized {
  const problems = layoutProblems(input.files);
  const files: MaterializedFile[] = [];
  const adoptions: Adoption[] = [];
  const writer = new Map<string, MaterializedFile>();
  for (const capability of input.selected) {
    const own = [...input.files].filter(([path]) => capabilityOf(path) === capability);
    for (const [path, content] of own) {
      const target = workspacePathOf(path);
      if (ADOPT_FILE.test(path)) {
        adoptions.push(...adoptionsOf(capability, path, input.parse(content), problems));
      } else if (target === null) {
        problems.push(`${path}: not in a project folder (source/<capability>/<scope>/...)`);
      } else {
        files.push(...copyOf({ path: target, text: content, capability }, writer, problems));
      }
    }
  }
  return { files, adoptions, problems: problems.sort() };
}
