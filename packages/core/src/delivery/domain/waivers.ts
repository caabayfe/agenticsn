// Waivers (ADR-0006): a reviewed exception for one rule on the files a glob matches, with a
// reason, an approver and an expiry at most 366 days ahead. Kept in waivers.yaml, in git.

export interface Waiver {
  readonly rule: string;
  // Relative to the workspace root, for example instances/dev/metadata/global/**.
  readonly path: string;
  readonly reason: string;
  readonly approver: string;
  // YYYY-MM-DD, inclusive.
  readonly expires: string;
}

export interface WaiverProblem {
  readonly index: number;
  readonly reason: string;
}

const MAX_DAYS = 366;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const day = (date: Date) => date.toISOString().slice(0, 10);

function problemOf(entry: unknown, today: Date): string | Waiver {
  if (entry === null || typeof entry !== "object") {
    return "not a mapping";
  }
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(entry));
  const value = (key: string) => {
    const field = fields[key];
    return typeof field === "string" ? field.trim() : "";
  };
  const waiver = {
    rule: value("rule"),
    path: value("path"),
    reason: value("reason"),
    approver: value("approver"),
    expires: value("expires"),
  };
  const missing = Object.entries(waiver).filter(([, field]) => field === "");
  if (missing.length > 0) {
    return `missing ${missing.map(([key]) => key).join(", ")}`;
  }
  if (!DATE.test(waiver.expires)) {
    return "expires must be a date (YYYY-MM-DD)";
  }
  if (waiver.expires < day(today)) {
    return `expired on ${waiver.expires}`;
  }
  const limit = new Date(today.getTime() + MAX_DAYS * 86_400_000);
  if (waiver.expires > day(limit)) {
    return `expires more than ${MAX_DAYS} days ahead`;
  }
  return waiver;
}

// The waivers in force today; expired or malformed ones waive nothing and are reported.
export function readWaivers(
  document: unknown,
  today: Date,
): { readonly waivers: Waiver[]; readonly problems: WaiverProblem[] } {
  const list =
    document !== null && typeof document === "object" && "waivers" in document
      ? document.waivers
      : [];
  const entries: unknown[] = Array.isArray(list) ? list : [];
  const waivers: Waiver[] = [];
  const problems: WaiverProblem[] = [];
  entries.forEach((entry, index) => {
    const outcome = problemOf(entry, today);
    if (typeof outcome === "string") {
      problems.push({ index, reason: outcome });
    } else {
      waivers.push(outcome);
    }
  });
  return { waivers, problems };
}

// `*` and `?` stay within a folder; `**` crosses folders.
export function globMatches(glob: string, path: string): boolean {
  let pattern = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i] ?? "";
    if (char === "*" && glob[i + 1] === "*") {
      pattern += ".*";
      i += 1;
    } else if (char === "*") {
      pattern += "[^/]*";
    } else if (char === "?") {
      pattern += "[^/]";
    } else {
      pattern += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${pattern}$`).test(path);
}

export function waiverFor(waivers: readonly Waiver[], rule: string, path: string): Waiver | null {
  return waivers.find((waiver) => waiver.rule === rule && globMatches(waiver.path, path)) ?? null;
}
