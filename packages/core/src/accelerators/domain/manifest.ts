import { graphProblems } from "./capability-graph";
import type {
  Capability,
  Component,
  DataColumn,
  DataEntity,
  Manifest,
  RequiredField,
} from "./manifest-types";

// Reads a pack's manifest (ADR-0026, format 2 by ADR-0038): accelerator.yaml with its modules
// under `modules` (packDocument assembles it). Pure: the document comes parsed.

export type ManifestOutcome =
  | { readonly ok: true; readonly manifest: Manifest }
  | { readonly ok: false; readonly problems: readonly string[] };

const ID = /^[a-z0-9][a-z0-9_-]*$/;
const VERSION = /^\d+\.\d+\.\d+$/;

type Fields = Readonly<Record<string, unknown>>;

const fieldsOf = (value: unknown): Fields | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const texts = (value: unknown) => list(value).map(text).filter(Boolean);

function component(value: unknown): Component | null {
  const fields = fieldsOf(value);
  const id = text(fields?.["id"]);
  if (fields === null || id === "") return null;
  const minVersion = text(fields["minVersion"]);
  return {
    kind: fields["kind"] === "app" ? "app" : "plugin",
    id,
    minVersion: minVersion === "" ? null : minVersion,
    entitlement: fields["entitlement"] === "licensed" ? "licensed" : "free",
  };
}

function columnsOf(value: unknown): DataColumn[] {
  return Object.entries(fieldsOf(value) ?? {}).map(([name, rules]) => {
    const r = fieldsOf(rules);
    const references = text(r?.["references"]);
    const field = text(r?.["field"]);
    return {
      name,
      required: r?.["required"] === true,
      references: references === "" ? null : references,
      field: field === "" ? null : field,
      domain: r?.["domain"] === true,
    };
  });
}

function entity(value: unknown): DataEntity | null {
  const fields = fieldsOf(value);
  const name = text(fields?.["entity"]);
  const table = text(fields?.["table"]);
  const key = texts(fields?.["key"]);
  if (name === "" || table === "" || key.length === 0) return null;
  const file = text(fields?.["file"]) || `${name}.csv`;
  return {
    entity: name,
    file,
    table,
    target: text(fields?.["target"]) || null,
    key,
    after: texts(fields?.["after"]),
    columns: columnsOf(fields?.["columns"]),
    anchors: fields?.["anchors"] === true,
    from: text(fields?.["from"]) || null,
  };
}

const FIELD = /^[a-z0-9_]+\.[a-z0-9_]+$/;

// One entry of a module's `fields`: { field: table.field, from?, when_missing?, note? }.
function requiredField(value: unknown, say: (problem: string) => void): RequiredField | null {
  const fields = fieldsOf(value);
  const name = text(fields?.["field"]);
  const when = text(fields?.["when_missing"]) || "stop";
  if (!FIELD.test(name)) {
    say("must be table.field");
    return null;
  }
  if (when !== "stop" && when !== "warn") {
    say("when_missing is stop or warn");
    return null;
  }
  const [table = "", field = ""] = name.split(".");
  return {
    table,
    field,
    from: text(fields?.["from"]) || null,
    whenMissing: when,
    note: text(fields?.["note"]) || null,
  };
}

function capability(pack: string, id: string, value: unknown, problems: string[]): Capability {
  const fields = fieldsOf(value) ?? {};
  const say = (problem: string) => problems.push(`module ${id}: ${problem}`);
  if (!ID.test(id)) say("its folder name must be lowercase letters, digits, - or _");
  const components = list(fields["components"]).map(
    (p, i) => component(p) ?? say(`component ${i + 1} needs an id`),
  );
  const data = list(fields["data"]).map(
    (d, i) => entity(d) ?? say(`data ${i + 1} needs entity, table and key`),
  );
  const required = list(fields["fields"]).map((f, i) =>
    requiredField(f, (problem) => say(`field ${i + 1} ${problem}`)),
  );
  return {
    id,
    label: text(fields["label"]) || `${pack}/${id}`,
    dependsOn: texts(fields["dependsOn"]),
    components: components.filter((c): c is Component => typeof c === "object"),
    data: data.filter((d): d is DataEntity => typeof d === "object"),
    fields: required.filter((f): f is RequiredField => f !== null),
  };
}

function identity(fields: Fields, problems: string[]) {
  const id = text(fields["id"]);
  const version = text(fields["version"]);
  if (!ID.test(id)) problems.push("id must be lowercase letters, digits, - or _");
  if (!VERSION.test(version)) problems.push("version must be major.minor.patch");
  const requires = fieldsOf(fields["requires"]);
  const platform = fieldsOf(fields["platform"]);
  return {
    id,
    version,
    requires: { snagentic: text(requires?.["snagentic"]) },
    tested: texts(platform?.["tested"]).map((t) => t.toLowerCase()),
  };
}

function profilesOf(value: unknown, modules: ReadonlySet<string>, problems: string[]) {
  const profiles: Record<string, readonly string[]> = {};
  for (const [id, members] of Object.entries(fieldsOf(value) ?? {})) {
    const named = texts(members);
    if (!ID.test(id)) problems.push(`profile ${id}: lowercase letters, digits, - or _`);
    if (named.length === 0) problems.push(`profile ${id}: names no module`);
    for (const m of named.filter((m) => !modules.has(m))) {
      problems.push(`profile ${id} names ${m}, which the pack does not have`);
    }
    profiles[id] = named;
  }
  return profiles;
}

// Reads and checks a manifest: every problem at once, so the pack's author fixes them together.
export function parseManifest(document: unknown): ManifestOutcome {
  const fields = fieldsOf(document);
  if (fields === null) return { ok: false, problems: ["the manifest is not a mapping"] };
  const problems: string[] = [];
  const head = identity(fields, problems);
  const entries = Object.entries(fieldsOf(fields["modules"]) ?? {});
  if (entries.length === 0) problems.push("modules: at least one (modules/<module>/module.yaml)");
  const capabilities = entries
    .map(([id, value]) => capability(head.id, id, value, problems))
    .sort((a, b) => a.id.localeCompare(b.id));
  const profiles = profilesOf(fields["profiles"], new Set(entries.map(([id]) => id)), problems);
  if (problems.length > 0) return { ok: false, problems };
  const graph = graphProblems(capabilities);
  return graph.length > 0
    ? { ok: false, problems: graph }
    : { ok: true, manifest: { ...head, profiles, capabilities } };
}
