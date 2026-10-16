import type { Finding, FindingSeverity } from "../../governance/domain/findings";
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
    const where = finding.root === "workspace" ? finding.path : `${prefix}/${finding.path}`;
    const waiver = waiverFor(waivers, finding.ruleId, where);
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
