import type { Finding, FindingSeverity } from "../../governance/domain/findings";
import { canonicalJson } from "../../kernel/canonical-json";
import { sha256Hex } from "../../kernel/sha256";
import type { PlannedWrite } from "./change";
import { type Waiver, type WaiverProblem, waiverFor } from "./waivers";

export interface GateFinding {
  readonly ruleId: string;
  readonly severity: FindingSeverity;
  readonly path: string;
  readonly line: number | null;
  readonly message: string;
}

export interface GateResult {
  // No unwaived block finding (ADR-0006).
  readonly passed: boolean;
  readonly blocking: readonly GateFinding[];
  readonly waived: readonly (GateFinding & {
    readonly reason: string;
    readonly approver: string;
  })[];
  readonly warnings: number;
  readonly waiverProblems: readonly WaiverProblem[];
}

const brief = (finding: Finding): GateFinding => ({
  ruleId: finding.ruleId,
  severity: finding.severity,
  path: finding.path,
  line: finding.line,
  message: finding.message,
});

// The gate over the change's introduced findings. Waiver globs are relative to the workspace,
// finding paths to the instance's metadata folder (`prefix` joins them).
export function gateOf(
  findings: readonly Finding[],
  waivers: readonly Waiver[],
  waiverProblems: readonly WaiverProblem[],
  prefix: string,
): GateResult {
  const blocking: GateFinding[] = [];
  const waived: GateResult["waived"][number][] = [];
  for (const finding of findings.filter((f) => f.severity === "block")) {
    const waiver = waiverFor(waivers, finding.ruleId, `${prefix}/${finding.path}`);
    if (waiver === null) {
      blocking.push(brief(finding));
    } else {
      waived.push({ ...brief(finding), reason: waiver.reason, approver: waiver.approver });
    }
  }
  return {
    passed: blocking.length === 0,
    blocking,
    waived,
    warnings: findings.filter((f) => f.severity !== "block").length,
    waiverProblems,
  };
}

// Binds a plan to exactly what it would write, from which mirror state, under which gate
// outcome: any edit, pull, finding or waiver gives another id.
export function planId(
  mirrorCommit: string,
  writes: readonly PlannedWrite[],
  gate: GateResult,
): string {
  const material = canonicalJson({
    mirror: mirrorCommit,
    writes: writes.map((write) => ({
      operation: write.operation,
      table: write.table,
      sysId: write.sysId,
      baseHash: write.baseHash ?? "",
      values: Object.fromEntries(
        Object.entries(write.values).map(([name, value]) => [name, sha256Hex(value)]),
      ),
    })),
    gate: {
      passed: gate.passed,
      blocking: gate.blocking.map((f) => `${f.ruleId} ${f.path}:${f.line ?? ""}`),
      waived: gate.waived.map((f) => `${f.ruleId} ${f.path}:${f.line ?? ""} ${f.approver}`),
    },
  });
  return sha256Hex(material).slice(0, 16);
}
