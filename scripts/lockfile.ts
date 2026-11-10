// Reads bun.lock to say which installed copies of a package exist and which direct dependency of
// a workspace brings each one in, so an advisory decision can name the versions and paths it
// covers (spec 014, F2). `bun audit --json` gives neither.

export interface InstalledCopy {
  readonly key: string;
  readonly name: string;
  readonly version: string;
  readonly dependencies: readonly string[];
}

export interface Lockfile {
  readonly copies: ReadonlyMap<string, InstalledCopy>;
  // Each workspace's direct dependencies: where every path into the tree starts.
  readonly entries: readonly { readonly from: string; readonly name: string }[];
}

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function dependencyNames(meta: unknown): string[] {
  const fields = record(meta);
  return DEPENDENCY_FIELDS.flatMap((field) => Object.keys(record(fields[field])));
}

// "name@version": the name may be scoped, so the version follows the last "@".
function nameAndVersion(spec: unknown): { name: string; version: string } | null {
  if (typeof spec !== "string") return null;
  const at = spec.lastIndexOf("@");
  if (at <= 0) return null;
  return { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

function workspaceEntries(workspaces: Record<string, unknown>) {
  return Object.values(workspaces).flatMap((workspace) => {
    const fields = record(workspace);
    const from = typeof fields["name"] === "string" ? fields["name"] : "";
    return DEPENDENCY_FIELDS.flatMap((field) =>
      Object.entries(record(fields[field]))
        .filter(([, range]) => !String(range).startsWith("workspace:"))
        .map(([name]) => ({ from, name })),
    );
  });
}

export function parseLockfile(text: string): Lockfile {
  const lock = record(Bun.JSONC.parse(text));
  const copies = new Map<string, InstalledCopy>();
  for (const [key, entry] of Object.entries(record(lock["packages"]))) {
    if (!Array.isArray(entry)) continue;
    const parsed = nameAndVersion(entry[0]);
    if (parsed === null || parsed.version.startsWith("workspace:")) continue;
    copies.set(key, { key, ...parsed, dependencies: dependencyNames(entry[2]) });
  }
  return { copies, entries: workspaceEntries(record(lock["workspaces"])) };
}

// A key is the chain of package names it is nested under: "a/@s/b/c" is a, @s/b, c.
function packageNames(key: string): string[] {
  const names: string[] = [];
  const parts = key.split("/");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? "";
    names.push(part.startsWith("@") ? `${part}/${parts[++i] ?? ""}` : part);
  }
  return names;
}

// Node resolution over bun.lock keys: the copy nested deepest along the dependent's own chain.
function resolve(lock: Lockfile, from: string, name: string): string | null {
  const chain = from === "" ? [] : packageNames(from);
  for (let depth = chain.length; depth >= 0; depth--) {
    const key = [...chain.slice(0, depth), name].join("/");
    if (lock.copies.has(key)) return key;
  }
  return null;
}

function reachable(lock: Lockfile, start: string): Set<string> {
  const seen = new Set<string>([start]);
  const pending = [start];
  for (let key = pending.pop(); key !== undefined; key = pending.pop()) {
    for (const name of lock.copies.get(key)?.dependencies ?? []) {
      const next = resolve(lock, key, name);
      if (next !== null && !seen.has(next)) {
        seen.add(next);
        pending.push(next);
      }
    }
  }
  return seen;
}

export interface ReachedCopy {
  readonly version: string;
  // The workspaces' direct dependencies whose tree holds this copy.
  readonly through: readonly string[];
}

// Every installed copy of `name`, with the direct dependencies that bring it in.
export function copiesOf(lock: Lockfile, name: string): ReachedCopy[] {
  const through = new Map<string, Set<string>>();
  for (const entry of lock.entries) {
    const start = resolve(lock, entry.from, entry.name);
    if (start === null) continue;
    for (const key of reachable(lock, start)) {
      if (lock.copies.get(key)?.name !== name) continue;
      const found = through.get(key) ?? new Set<string>();
      found.add(entry.name);
      through.set(key, found);
    }
  }
  return [...through]
    .map(([key, names]) => ({
      version: lock.copies.get(key)?.version ?? "",
      through: [...names].sort(),
    }))
    .sort((left, right) => Bun.semver.order(left.version, right.version));
}
