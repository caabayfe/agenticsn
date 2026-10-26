import { type EnsureFact, ensureFactsOf } from "./ensure";
import { isAdoptFile, isEnsureFile, isPackOnly, moduleOf, workspacePathOf } from "./pack-layout";

// What adding a pack's modules writes into the workspace (ADR-0026 as amended by ADR-0031):
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
  // What the install does where the instance lacks the record: stop for review, or create it
  // from the module's source (a record that ships only with demo data, restated whole).
  readonly whenAbsent: "stop" | "create";
  // A record the module's build restates as the instance holds it now (a form section it adds
  // fields to): a client's customization is kept in it, so it does not stop the install.
  readonly restated?: true;
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
  // Layouts the modules add to, found by table and view (ADR-0042).
  readonly ensures: readonly EnsureFact[];
  readonly problems: readonly string[];
}

const SYS_ID = /^[0-9a-f]{32}$/;

// Pack files that are not installed, not module content, and not the manifest: every one named.
function layoutProblems(files: ReadonlyMap<string, string>): string[] {
  return [...files.keys()]
    .filter((path) => !isPackOnly(path) && moduleOf(path) === null)
    .sort()
    .map((path) => `${path}: not under modules/<module>/ (ADR-0038)`);
}

const text = (entry: Readonly<Record<string, unknown>>, key: string) => {
  const value = entry[key];
  return typeof value === "string" ? value.trim() : "";
};

function adoptionsOf(capability: string, path: string, document: unknown, problems: string[]) {
  if (!Array.isArray(document)) {
    problems.push(`${path}: a list of { table, sys_id, note, when_absent? }`);
    return [];
  }
  return document.flatMap((item: unknown, index): Adoption[] => {
    const entry =
      item !== null && typeof item === "object" ? Object.fromEntries(Object.entries(item)) : {};
    const whenAbsent = text(entry, "when_absent");
    const adoption: Adoption = {
      capability,
      table: text(entry, "table"),
      sysId: text(entry, "sys_id"),
      note: text(entry, "note"),
      whenAbsent: whenAbsent === "create" ? "create" : "stop",
    };
    if (whenAbsent !== "" && whenAbsent !== "create") {
      problems.push(`${path}: entry ${index + 1} when_absent can only be create`);
      return [];
    }
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
  const ensures: EnsureFact[] = [];
  const writer = new Map<string, MaterializedFile>();
  for (const capability of input.selected) {
    const own = [...input.files].filter(
      ([path]) => moduleOf(path) === capability && !isPackOnly(path),
    );
    for (const [path, content] of own) {
      const target = workspacePathOf(path);
      if (isAdoptFile(path)) {
        adoptions.push(...adoptionsOf(capability, path, input.parse(content), problems));
      } else if (isEnsureFile(path)) {
        ensures.push(...ensureFactsOf(capability, path, input.parse(content), problems));
      } else if (target === null) {
        problems.push(`${path}: not in a project folder (modules/<module>/source/<scope>/...)`);
      } else {
        files.push(...copyOf({ path: target, text: content, capability }, writer, problems));
      }
    }
  }
  return { files, adoptions, ensures, problems: problems.sort() };
}
