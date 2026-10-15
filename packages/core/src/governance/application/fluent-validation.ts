import { ruleById } from "../../advice/index";
import type { Finding } from "../domain/findings";
import type { FluentProject } from "../domain/fluent-findings";
import { fluentFindings } from "../domain/fluent-findings";
import type { FluentProjects } from "../ports";

export interface FluentCheck {
  readonly projects: number;
  readonly findings: readonly Finding[];
}

const NONE: FluentCheck = { projects: 0, findings: [] };

// Builds each Fluent project the change touches, in a copy, and reports what stops it from
// being delivered (ADR-0028 as amended). `paths` (workspace-relative) narrows it to the
// projects holding them; otherwise every project changed since `commit`.
export async function checkFluent(
  fluent: FluentProjects | undefined,
  commit: string,
  paths: readonly string[] | undefined,
): Promise<FluentCheck> {
  if (fluent === undefined) return NONE;
  const projects: readonly FluentProject[] =
    paths === undefined ? await fluent.changedSince(commit) : await fluent.holding(paths);
  if (projects.length === 0) return NONE;
  const sdkVersion = await fluent.sdkVersion();
  const findings: Finding[] = [];
  for (const project of projects) {
    for (const hit of fluentFindings(project, await fluent.build(project), sdkVersion)) {
      const rule = ruleById(hit.ruleId);
      if (rule === undefined) continue;
      findings.push({
        ...hit,
        severity: rule.severity,
        title: rule.title,
        why: rule.why,
        remediation: rule.remediation,
        root: "workspace",
        field: null,
      });
    }
  }
  return { projects: projects.length, findings };
}
