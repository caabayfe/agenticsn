import type { Capability, DataEntity, Manifest } from "./manifest-types";

// The capabilities of a pack form a graph by dependsOn, and its data entities one by after
// (spec 005 plan, M1). Pure.

type Edges = ReadonlyMap<string, readonly string[]>;

// A cycle as a path that ends where it starts, or null. Nodes in order, for a stable answer.
function cycleIn(nodes: readonly string[], edges: Edges): string[] | null {
  const state = new Map<string, "open" | "done">();
  const path: string[] = [];
  const visit = (node: string): string[] | null => {
    if (state.get(node) === "done") return null;
    if (state.get(node) === "open") return [...path.slice(path.indexOf(node)), node];
    state.set(node, "open");
    path.push(node);
    for (const next of edges.get(node) ?? []) {
      const found = visit(next);
      if (found !== null) return found;
    }
    path.pop();
    state.set(node, "done");
    return null;
  };
  for (const node of nodes) {
    const found = visit(node);
    if (found !== null) return found;
  }
  return null;
}

function dependencyProblems(capabilities: readonly Capability[]): string[] {
  const byId = new Map(capabilities.map((c) => [c.id, c]));
  const problems = capabilities.flatMap((c) =>
    c.dependsOn
      .filter((d) => !byId.has(d))
      .map((d) => `capability ${c.id} depends on ${d}, which the pack does not have`),
  );
  if (problems.length > 0) return problems;
  const cycle = cycleIn([...byId.keys()], new Map(capabilities.map((c) => [c.id, c.dependsOn])));
  if (cycle !== null) {
    return [`capabilities depend on each other in a cycle: ${cycle.join(" → ")}`];
  }
  return capabilities.flatMap((c) =>
    c.dependsOn.flatMap((d) => {
      const wave = byId.get(d)?.wave ?? 0;
      return wave > c.wave
        ? [
            `capability ${c.id} (wave ${c.wave}) depends on ${d}, which is in a later wave (${wave})`,
          ]
        : [];
    }),
  );
}

// Every capability a capability reaches through dependsOn, itself included.
function reach(capabilities: readonly Capability[], from: string): Set<string> {
  const byId = new Map(capabilities.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const d of byId.get(id)?.dependsOn ?? []) visit(d);
  };
  visit(from);
  return seen;
}

// Which capability defines each data entity; a second definition is a problem.
function owners(capabilities: readonly Capability[], problems: string[]): Map<string, string> {
  const owner = new Map<string, string>();
  for (const e of capabilities.flatMap((c) => c.data.map((d) => ({ ...d, by: c.id })))) {
    if (owner.has(e.entity)) problems.push(`data entity ${e.entity} is defined more than once`);
    else owner.set(e.entity, e.by);
  }
  return owner;
}

// An entity may load after one its capability reaches through dependsOn, never another.
function afterProblem(
  capability: string,
  entity: string,
  before: string,
  where: { readonly owner: ReadonlyMap<string, string>; readonly reachable: Set<string> },
): string | null {
  const by = where.owner.get(before);
  if (by === undefined) {
    return `data entity ${entity} loads after ${before}, which the pack does not define`;
  }
  return where.reachable.has(by)
    ? null
    : `data entity ${entity} loads after ${before}, which capability ${capability} does not reach (depend on ${by})`;
}

function dataProblems(capabilities: readonly Capability[]): string[] {
  const problems: string[] = [];
  const owner = owners(capabilities, problems);
  for (const c of capabilities) {
    const where = { owner, reachable: reach(capabilities, c.id) };
    for (const e of c.data) {
      problems.push(...e.after.flatMap((b) => afterProblem(c.id, e.entity, b, where) ?? []));
    }
  }
  if (problems.length > 0) return problems;
  const entities = capabilities.flatMap((c) => c.data);
  const cycle = cycleIn(
    entities.map((e) => e.entity),
    new Map(entities.map((e) => [e.entity, e.after])),
  );
  return cycle === null
    ? []
    : [`data entities load after each other in a cycle: ${cycle.join(" → ")}`];
}

// Problems with the graphs, given capabilities that are each well formed.
export function graphProblems(capabilities: readonly Capability[]): string[] {
  const dependencies = dependencyProblems(capabilities);
  return dependencies.length > 0 ? dependencies : dataProblems(capabilities);
}

// Visits `roots` and what they lead to through `next`, each node after the ones it leads to.
function dependenciesFirst(roots: readonly string[], next: (node: string) => readonly string[]) {
  const ordered: string[] = [];
  const visit = (node: string) => {
    if (ordered.includes(node)) return;
    for (const before of next(node)) visit(before);
    ordered.push(node);
  };
  for (const root of roots) visit(root);
  return ordered;
}

// The capabilities to install: those named, and those of the waves named (all when neither
// is), with every capability they depend on, dependencies first.
export function selectCapabilities(
  manifest: Manifest,
  ask: { readonly waves?: readonly number[]; readonly capabilities?: readonly string[] },
): { readonly capabilities: readonly string[]; readonly unknown: readonly string[] } {
  const byId = new Map(manifest.capabilities.map((c) => [c.id, c]));
  const named = ask.capabilities ?? [];
  const everything = ask.waves === undefined && ask.capabilities === undefined;
  const roots = manifest.capabilities
    .filter((c) => everything || named.includes(c.id) || (ask.waves ?? []).includes(c.wave))
    .sort((a, b) => a.wave - b.wave || a.id.localeCompare(b.id))
    .map((c) => c.id);
  return {
    capabilities: dependenciesFirst(roots, (id) => byId.get(id)?.dependsOn ?? []),
    unknown: named.filter((id) => !byId.has(id)),
  };
}

// The data entities of the selected capabilities, each after the ones it names.
export function dataOrder(manifest: Manifest, selected: readonly string[]): DataEntity[] {
  const entities = manifest.capabilities
    .filter((c) => selected.includes(c.id))
    .sort((a, b) => selected.indexOf(a.id) - selected.indexOf(b.id))
    .flatMap((c) => c.data);
  const byName = new Map(entities.map((e) => [e.entity, e]));
  const order = dependenciesFirst(
    entities.map((e) => e.entity),
    (name) => (byName.get(name)?.after ?? []).filter((a) => byName.has(a)),
  );
  return order.flatMap((name) => byName.get(name) ?? []);
}
