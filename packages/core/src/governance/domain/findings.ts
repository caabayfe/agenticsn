import { redactSecrets } from "../../kernel/redact";

export type FindingSeverity = "block" | "warn" | "info";

export interface Finding {
  readonly ruleId: string;
  readonly severity: FindingSeverity;
  readonly title: string;
  // The file to fix, relative to instances/<name>/metadata.
  readonly path: string;
  readonly field: string | null;
  readonly line: number | null;
  readonly message: string;
  // The line as written, unless it holds a credential.
  readonly evidence: string;
  readonly why: string;
  readonly remediation: string;
}

const CREDENTIAL_RULE = "SN-SEC-002";
const MASKED = "[redacted: this line holds a credential]";

// Evidence for findings on a script's lines. A line the credential rule flagged is masked
// for every rule, so no finding echoes the secret.
export function evidenceOf(
  source: string,
  hits: readonly { readonly ruleId: string; readonly line: number }[],
): (line: number) => string {
  const lines = source.split("\n");
  const masked = new Set(
    hits.filter((hit) => hit.ruleId === CREDENTIAL_RULE).map((hit) => hit.line),
  );
  return (line) =>
    masked.has(line) ? MASKED : redactSecrets((lines[line - 1] ?? "").trim()).slice(0, 200);
}

const keyOf = (finding: Finding) =>
  `${finding.ruleId}\u0000${finding.field}\u0000${finding.evidence}`;

// Findings the change introduced: those not already in the previous version, matched by rule,
// field and the line's text (not its number, which moves with every edit above it).
export function introduced(now: readonly Finding[], before: readonly Finding[]): Finding[] {
  const existing = new Map<string, number>();
  for (const finding of before) {
    existing.set(keyOf(finding), (existing.get(keyOf(finding)) ?? 0) + 1);
  }
  return now.filter((finding) => {
    const left = existing.get(keyOf(finding)) ?? 0;
    existing.set(keyOf(finding), left - 1);
    return left <= 0;
  });
}

const RANK: Readonly<Record<FindingSeverity, number>> = { block: 0, warn: 1, info: 2 };

// Most severe first, then by file and line, so results read the same on every run.
export function ordered(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      a.path.localeCompare(b.path) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.ruleId.localeCompare(b.ruleId),
  );
}
