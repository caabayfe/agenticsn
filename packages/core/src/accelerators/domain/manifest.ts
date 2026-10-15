import { graphProblems } from "./capability-graph";
import type {
  Capability,
  DataColumn,
  DataEntity,
  Manifest,
  PluginRequirement,
} from "./manifest-types";

// Reads accelerator.yaml (ADR-0026). Pure: the document comes parsed.

export type ManifestOutcome =
  | { readonly ok: true; readonly manifest: Manifest }
  | { readonly ok: false; readonly problems: readonly string[] };

const ID = /^[a-z0-9][a-z0-9_-]*$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const SCOPE = /^x_[a-z0-9]+_[a-z0-9_]+$/;

type Fields = Readonly<Record<string, unknown>>;

const fieldsOf = (value: unknown): Fields | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const texts = (value: unknown) => list(value).map(text).filter(Boolean);

function plugin(value: unknown): PluginRequirement | null {
  const fields = fieldsOf(value);
  const id = text(fields?.["id"]);
  if (fields === null || id === "") return null;
  const minVersion = text(fields["minVersion"]);
  return {
    id,
    minVersion: minVersion === "" ? null : minVersion,
    entitlement: fields["entitlement"] === "licensed" ? "licensed" : "free",
  };
}

function columnsOf(value: unknown): DataColumn[] {
  return Object.entries(fieldsOf(value) ?? {}).map(([name, rules]) => {
    const r = fieldsOf(rules);
    const references = text(r?.["references"]);
    return {
      name,
      required: r?.["required"] === true,
      references: references === "" ? null : references,
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
    key,
    after: texts(fields?.["after"]),
    columns: columnsOf(fields?.["columns"]),
  };
}

function capability(id: string, value: unknown, problems: string[]): Capability {
  const fields = fieldsOf(value) ?? {};
  const say = (problem: string) => problems.push(`capability ${id}: ${problem}`);
  const wave = fields["wave"];
  if (typeof wave !== "number" || !Number.isInteger(wave) || wave < 0) {
    say("wave must be a whole number from 0");
  }
  const label = text(fields["label"]);
  if (label === "") say("label is missing");
  const plugins = list(fields["plugins"]).map(
    (p, i) => plugin(p) ?? say(`plugin ${i + 1} needs an id`),
  );
  const data = list(fields["data"]).map(
    (d, i) => entity(d) ?? say(`data ${i + 1} needs entity, table and key`),
  );
  return {
    id,
    wave: typeof wave === "number" ? wave : 0,
    label,
    dependsOn: texts(fields["dependsOn"]),
    plugins: plugins.filter((p): p is PluginRequirement => typeof p === "object"),
    data: data.filter((d): d is DataEntity => typeof d === "object"),
  };
}

function identity(fields: Fields, problems: string[]) {
  const id = text(fields["id"]);
  const version = text(fields["version"]);
  const scope = text(fields["scope"]);
  if (!ID.test(id)) problems.push("id must be lowercase letters, digits, - or _");
  if (!VERSION.test(version)) problems.push("version must be major.minor.patch");
  if (!SCOPE.test(scope)) problems.push("scope must be x_<vendor>_<name>");
  const requires = fieldsOf(fields["requires"]);
  return { id, version, scope, requires: { snagentic: text(requires?.["snagentic"]) } };
}

// Reads and checks a manifest: every problem at once, so the pack's author fixes them together.
export function parseManifest(document: unknown): ManifestOutcome {
  const fields = fieldsOf(document);
  if (fields === null) return { ok: false, problems: ["the manifest is not a mapping"] };
  const problems: string[] = [];
  const head = identity(fields, problems);
  const entries = Object.entries(fieldsOf(fields["capabilities"]) ?? {});
  if (entries.length === 0) problems.push("capabilities: at least one");
  const capabilities = entries
    .map(([id, value]) => capability(id, value, problems))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (problems.length > 0) return { ok: false, problems };
  const graph = graphProblems(capabilities);
  return graph.length > 0
    ? { ok: false, problems: graph }
    : { ok: true, manifest: { ...head, capabilities } };
}
