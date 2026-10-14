// What adding a pack's capabilities writes into the workspace (ADR-0026, item 1): the pack's
// new records copied into the metadata layout, and its patches applied to the mirrored copies
// of out-of-box records. Pure: files come in as text, patches parsed by the caller.

export type MaterializedFile =
  | {
      readonly kind: "copy";
      // Relative to the instance's metadata folder.
      readonly path: string;
      readonly text: string;
      readonly capability: string;
    }
  | {
      readonly kind: "patch";
      readonly path: string;
      // The mirrored record with the patch's fields set; its _meta (and base hash) unchanged,
      // so plan sees an ordinary update.
      readonly document: Readonly<Record<string, unknown>>;
      readonly fields: readonly string[];
    };

export interface PatchTarget {
  readonly path: string;
  readonly document: Readonly<Record<string, unknown>>;
}

export interface MaterializeInput {
  // Capability ids, dependencies first.
  readonly selected: readonly string[];
  // The pack's files, by path in the pack.
  readonly files: ReadonlyMap<string, string>;
  // A patch file's text, parsed (YAML).
  readonly parse: (text: string) => unknown;
  // The mirrored record with this sys_id, or null.
  readonly mirrored: (sysId: string) => PatchTarget | null;
}

const PROTECTED = new Set(["_meta", "sys_id", "sys_class_name", "sys_scope"]);
const IGNORED = (path: string) => path === "accelerator.yaml" || path.startsWith("data/");

interface Patch {
  readonly table: string;
  readonly sysId: string;
  readonly fields: Readonly<Record<string, string>>;
}

function patchOf(document: unknown): Patch | null {
  if (document === null || typeof document !== "object") return null;
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(document));
  const values = fields["fields"];
  if (typeof fields["table"] !== "string" || typeof fields["sys_id"] !== "string") return null;
  if (values === null || typeof values !== "object") return null;
  const entries = Object.entries(values).map(([k, v]) => [k, String(v)] as const);
  return { table: fields["table"], sysId: fields["sys_id"], fields: Object.fromEntries(entries) };
}

// Fields pull never mirrors for this record (secret-like values): push cannot deliver them.
function redacted(document: Readonly<Record<string, unknown>>): Set<string> {
  const meta = document["_meta"];
  const list = meta !== null && typeof meta === "object" ? Reflect.get(meta, "redacted") : [];
  return new Set(Array.isArray(list) ? list.map(String) : []);
}

function applyPatch(path: string, input: MaterializeInput, problems: string[]): MaterializedFile[] {
  const patch = patchOf(input.parse(input.files.get(path) ?? ""));
  if (patch === null) {
    problems.push(`${path}: a patch needs table, sys_id and fields`);
    return [];
  }
  const blocked = Object.keys(patch.fields).filter((f) => PROTECTED.has(f));
  if (blocked.length > 0) {
    problems.push(`${path}: a patch may not change ${blocked.join(", ")}`);
    return [];
  }
  const record = input.mirrored(patch.sysId);
  const secret =
    record === null
      ? []
      : Object.keys(patch.fields).filter((f) => redacted(record.document).has(f));
  if (secret.length > 0) {
    problems.push(
      `${path}: ${secret.join(", ")} is never mirrored (it may hold a secret): set it on the instance`,
    );
    return [];
  }
  if (record === null) {
    problems.push(
      `${path}: ${patch.table} ${patch.sysId} is not in the mirror (run accelerator check; it may need a plugin)`,
    );
    return [];
  }
  const document = { ...record.document, ...patch.fields };
  return [{ kind: "patch", path: record.path, document, fields: Object.keys(patch.fields) }];
}

// A record file is named <name>--<sys_id>.yaml; its field files <name>--<sys_id>.<field>.<ext>.
export const RECORD_FILE = /^(.*)--([^-./]+)(\.[^/]+)$/;

// A pack record the instance already holds (an earlier version, pushed and pulled) is written
// onto its mirrored copy, at the mirrored path, like a patch of the pack's fields: adding the
// same version again then changes nothing, and the instance's other fields stay.
function onMirror(
  path: string,
  text: string,
  capability: string,
  input: MaterializeInput,
): MaterializedFile[] {
  const match = RECORD_FILE.exec(path);
  const existing = match === null ? null : input.mirrored(match[2] ?? "");
  if (match === null || existing === null) return [{ kind: "copy", path, text, capability }];
  const suffix = match[3] ?? "";
  if (suffix !== ".yaml") {
    return [{ kind: "copy", path: existing.path.replace(/\.yaml$/, suffix), text, capability }];
  }
  const parsed = input.parse(text);
  const hidden = redacted(existing.document);
  const fields = Object.fromEntries(
    Object.entries(parsed !== null && typeof parsed === "object" ? parsed : {}).filter(
      ([key]) => key !== "_meta" && !hidden.has(key),
    ),
  );
  const document = { ...existing.document, ...fields };
  return [{ kind: "patch", path: existing.path, document, fields: Object.keys(fields) }];
}

function fileOf(path: string, capability: string, input: MaterializeInput, problems: string[]) {
  const rest = path.split("/").slice(2);
  if (path.startsWith("patches/")) return applyPatch(path, input, problems);
  if (rest.length < 3) {
    problems.push(`${path}: not a record file in the workspace layout (<scope>/<class>/<file>)`);
    return [];
  }
  const text = input.files.get(path) ?? "";
  return onMirror(rest.join("/"), text, capability, input);
}

const capabilityOf = (path: string) => {
  const [top, capability] = path.split("/");
  return (top === "metadata" || top === "patches") && capability !== undefined ? capability : null;
};

// Pack files that are neither content nor the manifest and data templates.
function strayFiles(files: ReadonlyMap<string, string>): string[] {
  return [...files.keys()]
    .filter((path) => !IGNORED(path) && capabilityOf(path) === null)
    .map((path) => `${path}: not under metadata/<capability>/ or patches/<capability>/`);
}

// The files a selection writes, and every problem that stops it.
export function materialize(input: MaterializeInput): {
  readonly files: readonly MaterializedFile[];
  readonly problems: readonly string[];
} {
  const problems = strayFiles(input.files);
  const files: MaterializedFile[] = [];
  const writer = new Map<string, string>();
  const keep = (file: MaterializedFile, capability: string) => {
    const first = writer.get(file.path);
    if (first !== undefined) {
      problems.push(`${file.path} is written by both ${first} and ${capability}`);
      return;
    }
    writer.set(file.path, capability);
    files.push(file);
  };
  for (const capability of input.selected) {
    const paths = [...input.files.keys()].filter((p) => capabilityOf(p) === capability);
    for (const file of paths.flatMap((p) => fileOf(p, capability, input, problems))) {
      keep(file, capability);
    }
  }
  return { files, problems: problems.sort() };
}
