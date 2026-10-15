import type { PlanProblem } from "../domain/change";
import { type FluentRecord, fluentRecordOf } from "../domain/fluent-records";
import type { DeliveryWorkspace, FluentPackage, FluentPackages } from "../ports";

export interface PlannedFluentRecord extends FluentRecord {
  readonly project: string;
  readonly scope: string;
}

export interface FluentPlan {
  readonly packages: readonly FluentPackage[];
  readonly records: readonly PlannedFluentRecord[];
  readonly problems: readonly PlanProblem[];
}

// The ServiceNow IDE's publish endpoint as the mirror holds it (a scripted REST operation).
const OPERATIONS = "global/sys_ws_operation";
const PUBLISH_ENDPOINT = /(^|\/)activate-flows-and-actions--[0-9a-f]{32}$/;

export function recordsOf(fluentPackage: FluentPackage): PlannedFluentRecord[] {
  return fluentPackage.files.flatMap((file) => {
    const record = fluentRecordOf(file.content);
    return record === null
      ? []
      : [{ ...record, project: fluentPackage.project, scope: fluentPackage.scope }];
  });
}

// The Fluent projects a push would deliver, built in a copy, and what stops them before any
// write (ADR-0028 as amended, item 5). Build errors, uncommitted keys and deletes are gate
// findings (validate); this adds what the instance must offer.
export async function planFluent(
  deps: { readonly workspace: DeliveryWorkspace; readonly fluent?: FluentPackages },
  commit: string,
): Promise<FluentPlan> {
  const packages = deps.fluent === undefined ? [] : await deps.fluent.changedSince(commit);
  if (packages.length === 0) {
    return { packages, records: [], problems: [] };
  }
  const problems: PlanProblem[] = [];
  const operations = await deps.workspace.recordsIn(OPERATIONS, commit);
  if (!operations.some((base) => PUBLISH_ENDPOINT.test(base))) {
    problems.push({
      path: packages[0]?.project ?? "",
      reason:
        "the instance has no flow publishing endpoint (activate_flows, part of the ServiceNow IDE application): install it, pull, then plan again",
    });
  }
  for (const fluentPackage of packages.filter((p) => !p.configuration)) {
    problems.push({
      path: `${fluentPackage.project}/now.config.json`,
      reason:
        'push delivers Fluent projects of type "configuration" into the batch: set "type": "configuration" (and remove application settings such as name)',
    });
  }
  return { packages, records: packages.flatMap(recordsOf), problems };
}
