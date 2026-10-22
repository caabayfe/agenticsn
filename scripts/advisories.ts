// Compares `bun audit --json` with the advisory register (docs/security/advisories.md), so a
// new advisory, or an accepted one past its review date, fails CI (spec 012, step 2).

export interface Advisory {
  readonly id: string;
  readonly pkg: string;
  readonly severity: string;
  readonly title: string;
}

export interface RegisterEntry {
  readonly id: string;
  readonly pkg: string;
  readonly reviewBy: string;
}

export interface AdvisoryComparison {
  readonly unrecorded: readonly Advisory[];
  readonly expired: readonly Advisory[];
  readonly resolved: readonly RegisterEntry[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Rows of the register's table whose first cell is an advisory id; the last cell is the date.
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
    entries.push({ id, pkg: cells[2] ?? "", reviewBy });
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
export function parseAudit(json: string): Advisory[] {
  const report: unknown = JSON.parse(json);
  if (typeof report !== "object" || report === null) return [];
  const advisories: Advisory[] = [];
  for (const [pkg, list] of Object.entries(report)) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const id = field(item, "url").split("/").at(-1) ?? "";
      advisories.push({ id, pkg, severity: field(item, "severity"), title: field(item, "title") });
    }
  }
  return advisories;
}

// ISO dates compare as strings; an entry is still accepted on its review date.
export function compareAdvisories(
  found: readonly Advisory[],
  register: readonly RegisterEntry[],
  today: string,
): AdvisoryComparison {
  const byId = new Map(register.map((entry) => [entry.id, entry]));
  const reported = new Set(found.map((advisory) => advisory.id));
  return {
    unrecorded: found.filter((advisory) => !byId.has(advisory.id)),
    expired: found.filter((advisory) => {
      const entry = byId.get(advisory.id);
      return entry !== undefined && entry.reviewBy < today;
    }),
    resolved: register.filter((entry) => !reported.has(entry.id)),
  };
}
