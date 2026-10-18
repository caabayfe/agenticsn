import type { CensusGroup } from "./census";
import { DocumentationSourceError } from "./errors";
import { fieldsOf, textOf } from "./fields";
import type { Process, ProcessCapability } from "./process";

// processes/<process>/features.yaml (ADR-0040): the process's features, each with the
// applications the census found it in, or what a person saw on screen, and a decision.

export const FEATURE_STATUSES = ["documented", "todo", "out-of-scope", "question"] as const;
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

export interface Feature {
  readonly id: string;
  readonly title: string;
  readonly found: readonly string[];
  readonly status: FeatureStatus;
  readonly capabilities: readonly string[];
  // Why it is out of scope and who decided, or what to ask.
  readonly note?: string;
  // Found by looking at the screen: who, when (YYYY-MM-DD) and where.
  readonly seen?: { readonly by: string; readonly on: string; readonly where: string };
}

export interface ProcessFeatures {
  // processes/<process>/features.yaml
  readonly path: string;
  readonly process: string;
  readonly features: readonly Feature[];
}

const ID = /^[a-z][a-z0-9-]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isStatus = (value: string | undefined): value is FeatureStatus =>
  (FEATURE_STATUSES as readonly (string | undefined)[]).includes(value);

const strings = (raw: unknown): readonly string[] =>
  Array.isArray(raw) ? raw.flatMap((item) => textOf(item) ?? []) : [];

function seenOf(path: string, id: string, raw: unknown): Feature["seen"] {
  if (raw === undefined) return undefined;
  const fields = fieldsOf(raw);
  const on =
    fields["on"] instanceof Date ? fields["on"].toISOString().slice(0, 10) : textOf(fields["on"]);
  const by = textOf(fields["by"]);
  const where = textOf(fields["where"]);
  if (by === undefined || on === undefined || !DATE.test(on) || where === undefined) {
    throw new DocumentationSourceError(
      path,
      `feature ${id}: seen needs by, on (YYYY-MM-DD) and where`,
    );
  }
  return { by, on, where };
}

function featureOf(path: string, raw: unknown): Feature {
  const fields = fieldsOf(raw);
  const id = textOf(fields["id"]) ?? "";
  if (!ID.test(id)) {
    throw new DocumentationSourceError(path, `each feature needs an id in kebab-case, not "${id}"`);
  }
  const status = textOf(fields["status"]);
  if (!isStatus(status)) {
    throw new DocumentationSourceError(
      path,
      `feature ${id}: status must be ${FEATURE_STATUSES.join(", ")}`,
    );
  }
  const note = textOf(fields["note"]);
  if ((status === "out-of-scope" || status === "question") && note === undefined) {
    throw new DocumentationSourceError(
      path,
      `feature ${id}: ${status} needs a note (${status === "question" ? "what to ask" : "why, and who decided"})`,
    );
  }
  const seen = seenOf(path, id, fields["seen"]);
  const found = strings(fields["found"]);
  if (found.length === 0 && seen === undefined) {
    throw new DocumentationSourceError(path, `feature ${id}: needs found (applications) or seen`);
  }
  return {
    id,
    title: textOf(fields["title"]) ?? id,
    found,
    status,
    capabilities: strings(fields["capabilities"]),
    ...(note === undefined ? {} : { note }),
    ...(seen === undefined ? {} : { seen }),
  };
}

// `path` is processes/<id>/features.yaml.
export function parseFeatures(path: string, raw: unknown): ProcessFeatures {
  const items = fieldsOf(raw)["features"];
  const features = Array.isArray(items) ? items.map((item) => featureOf(path, item)) : [];
  const ids = features.map((feature) => feature.id);
  const twice = ids.find((id, index) => ids.indexOf(id) !== index);
  if (twice !== undefined) {
    throw new DocumentationSourceError(path, `feature ${twice} is listed twice`);
  }
  return { path, process: path.split("/")[1] ?? "", features };
}

// The capability a feature names: one of its own process (`report`), or of another process
// (`major-incident/communicate`), when that process documents it.
export function featureCapability(
  ref: string,
  own: string,
  processes: readonly Process[],
): { readonly process: Process; readonly capability: ProcessCapability } | null {
  const [first = "", second] = ref.split("/");
  const processId = second === undefined ? own : first;
  const capabilityId = second ?? first;
  const process = processes.find((item) => item.id === processId);
  const capability = process?.capabilities.find((item) => item.id === capabilityId);
  return process === undefined || capability === undefined ? null : { process, capability };
}

// A documented feature names the capabilities whose pages cover it, and only existing ones.
export function featureProblems(
  declared: ProcessFeatures,
  processes: readonly Process[],
): readonly {
  readonly kind: "unknown-process" | "undocumented-feature";
  readonly detail: string;
}[] {
  if (!processes.some((process) => process.id === declared.process)) {
    return [{ kind: "unknown-process", detail: declared.process }];
  }
  return declared.features.flatMap((feature) => {
    if (feature.status !== "documented") return [];
    if (feature.capabilities.length === 0) {
      return [
        { kind: "undocumented-feature" as const, detail: `${feature.id}: names no capability` },
      ];
    }
    return feature.capabilities
      .filter((ref) => featureCapability(ref, declared.process, processes) === null)
      .map((ref) => ({
        kind: "undocumented-feature" as const,
        detail: `${feature.id}: no capability ${ref}`,
      }));
  });
}

// What the census found that no feature claims (ADR-0040). A feature claims a whole application
// by its scope (`sn_comm_management`), or one thing in it by `<scope>:<name>`, as the census
// names it (`sn_sow_inc:Copy Incident`): an application holding several features is split. A
// group is returned with only the names no feature claims.
export function undecided(
  groups: readonly CensusGroup[],
  declared: ProcessFeatures,
): readonly CensusGroup[] {
  const claims = declared.features.flatMap((feature) => feature.found);
  return groups.flatMap((group) => {
    if (claims.includes(group.scope)) return [];
    const mine = new Set(
      claims
        .filter((claim) => claim.startsWith(`${group.scope}:`))
        .map((claim) => claim.slice(group.scope.length + 1)),
    );
    if (mine.size === 0) return [group];
    const items = group.items.flatMap((item) => {
      const names = item.names.filter((name) => !mine.has(name));
      return names.length === 0 ? [] : [{ ...item, count: names.length, names }];
    });
    const records = items.reduce((sum, item) => sum + item.count, 0);
    return items.length === 0 ? [] : [{ ...group, records, items }];
  });
}

// The features claiming an application, whole or in part.
export function claiming(declared: ProcessFeatures | null, scope: string): readonly string[] {
  return (declared?.features ?? [])
    .filter((feature) =>
      feature.found.some((claim) => claim === scope || claim.startsWith(`${scope}:`)),
    )
    .map((feature) => feature.id);
}

export function coverage(declared: ProcessFeatures): {
  readonly documented: number;
  readonly total: number;
} {
  const total = declared.features.filter((feature) => feature.status !== "out-of-scope").length;
  const documented = declared.features.filter((feature) => feature.status === "documented").length;
  return { documented, total };
}
