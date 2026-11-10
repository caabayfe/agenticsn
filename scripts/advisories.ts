// Compares `bun audit --json` with the advisory register (docs/security/advisories.md), so a
// new advisory, an accepted one past its review date (spec 012, step 2), or one that now hits a
// version or arrives through a path its decision doesn't name (spec 014, F2) fails CI.
import { copiesOf, type Lockfile } from "./lockfile";

export interface Advisory {
  readonly id: string;
  readonly pkg: string;
  readonly severity: string;
  readonly title: string;
  readonly vulnerable: string;
}

// One advisory as it applies here: the installed versions it hits, and the workspaces' direct
// dependencies that bring those versions in.
export interface Finding {
  readonly id: string;
  readonly pkg: string;
  readonly severity: string;
  readonly title: string;
  readonly versions: readonly string[];
  readonly through: readonly string[];
}

export interface RegisterEntry {
  readonly id: string;
  readonly pkg: string;
  readonly versions: readonly string[];
  readonly through: readonly string[];
  readonly reviewBy: string;
}

// What a finding and its decision disagree on: versions and paths on one side only.
export interface Difference {
  readonly id: string;
  readonly pkg: string;
  readonly versions: readonly string[];
  readonly through: readonly string[];
}

export interface AdvisoryComparison {
  readonly unrecorded: readonly Finding[];
  // Reported for a version or a path the decision doesn't name: the decision must be redone.
  readonly changed: readonly Difference[];
  readonly expired: readonly Finding[];
  readonly resolved: readonly RegisterEntry[];
  // The decision names versions or paths no longer reported: the row can be narrowed.
  readonly narrower: readonly Difference[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function list(cell: string): string[] {
  return cell
    .replaceAll("`", "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

// Rows of the register's table whose first cell is an advisory id:
// Advisory | Package | Versions | Through | Severity | Decision | Reason | Review by.
export function parseRegister(markdown: string): RegisterEntry[] {
  const entries: RegisterEntry[] = [];
  for (const line of markdown.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    const id = cells[1] ?? "";
    if (!id.startsWith("GHSA-")) continue;
    const reviewBy = cells.at(-2) ?? "";
    if (!DATE.test(reviewBy)) {
      throw new Error(`${id}: the register needs a review date (YYYY-MM-DD), found "${reviewBy}"`);
    }
    const versions = list(cells[3] ?? "");
    if (versions.length === 0) {
      throw new Error(`${id}: the register needs the installed versions the decision covers`);
    }
    entries.push({ id, pkg: cells[2] ?? "", versions, through: list(cells[4] ?? ""), reviewBy });
  }
  return entries;
}

function field(value: unknown, name: string): string {
  if (typeof value === "object" && value !== null && name in value) {
    const found: unknown = Reflect.get(value, name);
    if (typeof found === "string") return found;
  }
  return "";
}

// `bun audit --json` maps each package to its advisories; the id is the last segment of the url.
// An advisory that spans majors comes once per vulnerable range.
export function parseAudit(json: string): Advisory[] {
  const report: unknown = JSON.parse(json);
  if (typeof report !== "object" || report === null) return [];
  const advisories: Advisory[] = [];
  for (const [pkg, items] of Object.entries(report)) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      advisories.push({
        id: field(item, "url").split("/").at(-1) ?? "",
        pkg,
        severity: field(item, "severity"),
        title: field(item, "title"),
        vulnerable: field(item, "vulnerable_versions"),
      });
    }
  }
  return advisories;
}

const key = (item: { readonly id: string; readonly pkg: string }) => `${item.id} ${item.pkg}`;

// Groups an advisory's ranges, and keeps the installed copies that fall in any of them.
export function findingsOf(advisories: readonly Advisory[], lock: Lockfile): Finding[] {
  const groups = new Map<string, Advisory[]>();
  for (const advisory of advisories) {
    groups.set(key(advisory), [...(groups.get(key(advisory)) ?? []), advisory]);
  }
  return [...groups.values()].flatMap((ranges) => {
    const [first] = ranges;
    if (first === undefined) return [];
    const hit = copiesOf(lock, first.pkg).filter((copy) =>
      ranges.some((range) => Bun.semver.satisfies(copy.version, range.vulnerable)),
    );
    const { id, pkg, severity, title } = first;
    const versions = [...new Set(hit.map((copy) => copy.version))];
    const through = [...new Set(hit.flatMap((copy) => copy.through))].sort();
    return [{ id, pkg, severity, title, versions, through }];
  });
}

interface Covered {
  readonly versions: readonly string[];
  readonly through: readonly string[];
}

const missing = (from: readonly string[], within: readonly string[]) =>
  from.filter((item) => !within.includes(item));

function difference(from: Covered, within: Covered, item: Finding): Difference[] {
  const versions = missing(from.versions, within.versions);
  const through = missing(from.through, within.through);
  return versions.length === 0 && through.length === 0
    ? []
    : [{ id: item.id, pkg: item.pkg, versions, through }];
}

// ISO dates compare as strings; an entry is still accepted on its review date.
export function compareAdvisories(
  found: readonly Finding[],
  register: readonly RegisterEntry[],
  today: string,
): AdvisoryComparison {
  const byKey = new Map(register.map((entry) => [key(entry), entry]));
  const reported = new Set(found.map(key));
  const recorded = found.flatMap((finding) => {
    const entry = byKey.get(key(finding));
    return entry === undefined ? [] : [{ finding, entry }];
  });
  return {
    unrecorded: found.filter((finding) => !byKey.has(key(finding))),
    changed: recorded.flatMap(({ finding, entry }) => difference(finding, entry, finding)),
    expired: recorded.filter(({ entry }) => entry.reviewBy < today).map(({ finding }) => finding),
    resolved: register.filter((entry) => !reported.has(key(entry))),
    narrower: recorded.flatMap(({ finding, entry }) => difference(entry, finding, finding)),
  };
}
