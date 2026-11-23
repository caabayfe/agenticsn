// Waivers (ADR-0006): a reviewed exception for one rule on the files a glob matches, with a
// reason, an approver and an expiry at most 366 days ahead. Kept in waivers.yaml, in git.
// Which copy of the file the gate accepts is ADR-0058: the branch's own in solo mode, the
// reviewed branch's in team mode.

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
// A waiver covers files of a scope's Fluent project (ADR-0031), never a whole workspace:
// wildcards may not reach the scope.
const SCOPED_PATH = /^source\/[^/*?]+\/.+$/;

// Index -1: about the file, not one entry.
export const UNCOMMITTED_WAIVERS: WaiverProblem = {
  index: -1,
  reason: "waivers.yaml has uncommitted changes; only committed waivers apply",
};

// waivers.yaml on the reviewed branch: the default branch of the team's remote, as this clone
// last fetched it (`branch` is for example origin/main; `document` is null when it has no file).
// `unresolved`: the clone has no record of the remote's default branch.
export type ReviewedWaivers =
  | { readonly kind: "found"; readonly branch: string; readonly document: unknown | null }
  | { readonly kind: "unresolved"; readonly remote: string };

// waivers.yaml as the branch has it: committed (parsed, or null when there is none), and whether
// the working tree differs.
export interface BranchWaivers {
  readonly committed: unknown | null;
  readonly uncommitted: boolean;
}

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
  if (!SCOPED_PATH.test(waiver.path) || waiver.path.split("/").includes("..")) {
    return "path must start source/<scope>/, without wildcards before the scope";
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

const about = (reason: string): WaiverProblem => ({ index: -1, reason });
const same = (a: Waiver, b: Waiver) =>
  a.rule === b.rule &&
  a.path === b.path &&
  a.reason === b.reason &&
  a.approver === b.approver &&
  a.expires === b.expires;

// The waivers the gate accepts (ADR-0058). Solo mode (`reviewed` null): the ones committed on the
// branch. Team mode: only the ones on the reviewed branch, so each has passed a pull request; what
// the branch adds or changes waives nothing and is reported with what to do.
export function acceptedWaivers(
  branch: BranchWaivers,
  reviewed: ReviewedWaivers | null,
  today: Date,
): { readonly waivers: Waiver[]; readonly problems: WaiverProblem[] } {
  const local = readWaivers(branch.committed, today);
  if (reviewed === null) {
    const problems = branch.uncommitted ? [UNCOMMITTED_WAIVERS, ...local.problems] : local.problems;
    return { waivers: local.waivers, problems };
  }
  if (reviewed.kind === "unresolved") {
    const reason = `this clone does not know the default branch of ${reviewed.remote}, so no waiver applies: run git remote set-head ${reviewed.remote} --auto`;
    return { waivers: [], problems: [about(reason)] };
  }
  const accepted = readWaivers(reviewed.document, today);
  const remote = reviewed.branch.split("/")[0] ?? reviewed.branch;
  const unreviewed = local.waivers
    .filter((waiver) => !accepted.waivers.some((other) => same(waiver, other)))
    .map((waiver) =>
      about(
        `the waiver for ${waiver.rule} on ${waiver.path} is not on ${reviewed.branch}, so it does not apply: open a pull request for it, and run git fetch ${remote} once it is merged`,
      ),
    );
  const uncommitted = branch.uncommitted
    ? [
        about(
          `waivers.yaml has uncommitted changes; only waivers on ${reviewed.branch} apply: open a pull request for them`,
        ),
      ]
    : [];
  return {
    waivers: accepted.waivers,
    problems: [...uncommitted, ...unreviewed, ...accepted.problems],
  };
}
