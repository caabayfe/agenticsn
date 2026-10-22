import { olderThan } from "./preflight";

// The pack's update sets from installs of an older version, still in progress (ADR-0038,
// section 6): an upgrade completes them before its first push, so they are promoted before the
// new ones and the newest version of a record wins. Pure.

export interface OpenSet {
  readonly sysId: string;
  readonly name: string;
  // The parent set's sys_id; empty for a top-level set.
  readonly parent: string;
  // When it was created (the instance's "yyyy-mm-dd hh:mm:ss"): orders sets of one version.
  readonly createdOn: string;
}

export interface PackNaming {
  readonly pack: string;
  readonly version: string;
  // The modules' update set labels, without their version.
  readonly labels: readonly string[];
  // Update sets earlier installs of the pack recorded pushing into (their reports).
  readonly recorded: readonly string[];
}

const PREFIX = "snagentic: ";
// "<label> <version>" or "<pack> <version> upgrade", before an optional " [scope]".
const VERSIONED = /^(.+) (\d+(?:\.\d+)*)( upgrade)?$/;

const withoutScope = (name: string) => name.replace(/ \[[^\]]+\]$/, "");

// The version of a set the pack made, or null when the set is not the pack's.
function packVersion(naming: PackNaming, name: string): string | null {
  if (!name.startsWith(PREFIX)) return null;
  const base = withoutScope(name);
  const match = VERSIONED.exec(base.slice(PREFIX.length));
  if (match === null) return null;
  const [, owner = "", version = "", upgrade] = match;
  const recorded = naming.recorded.some((r) => withoutScope(r) === base);
  const named = upgrade === undefined ? naming.labels.includes(owner) : owner === naming.pack;
  return recorded || named ? version : null;
}

// Top-level sets only, oldest version first, then as they were created: completing a parent
// completes its children (spec 011, spike S-U).
export function earlierSets(naming: PackNaming, open: readonly OpenSet[]): OpenSet[] {
  const found = open.flatMap((set) => {
    const version = set.parent === "" ? packVersion(naming, set.name) : null;
    return version !== null && olderThan(version, naming.version) ? [{ set, version }] : [];
  });
  return found
    .sort((a, b) => {
      if (a.version !== b.version) return olderThan(a.version, b.version) ? -1 : 1;
      const [x, y] = [a.set.createdOn + a.set.name, b.set.createdOn + b.set.name];
      return x < y ? -1 : x > y ? 1 : 0;
    })
    .map((f) => f.set);
}

const INTO = " unit(s) into ";

// A delivered step's detail in the install report; `recordedSets` reads it back.
export function deliveredDetail(units: number, updateSets: readonly string[]): string {
  return `${units}${INTO}${updateSets.join(", ")}`;
}

// The update sets an install report's delivered steps name.
export function recordedSets(report: string): string[] {
  return report.split("\n").flatMap((line) => {
    const cells = line.split(" | ");
    const detail = cells.find((cell) => cell.includes(INTO)) ?? "";
    const sets = detail.slice(detail.indexOf(INTO) + INTO.length);
    return detail === "" ? [] : sets.split(/, (?=snagentic: )/);
  });
}
