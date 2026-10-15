import { type Finding, type ValidateDependencies, validate } from "../../governance/index";
import { type GateResult, gateOf } from "../domain/gate";
import { readWaivers, UNCOMMITTED_WAIVERS } from "../domain/waivers";
import type { DeliveryWorkspace } from "../ports";

// What the gate reads: validate's dependencies, the accelerator check, the committed waivers.
export interface GateDependencies {
  readonly governance: ValidateDependencies;
  readonly packGate?: (paths: readonly string[]) => Promise<readonly Finding[]>;
  readonly workspace: Pick<DeliveryWorkspace, "waivers" | "metadataRoot">;
  readonly now: () => Date;
}

// validate over the change, plus the accelerator packs' check, with committed waivers applied.
export async function gateFor(
  deps: GateDependencies,
  commit: string,
  paths: readonly string[],
): Promise<GateResult> {
  const validation = await validate(deps.governance, { base: commit });
  const packs = deps.packGate === undefined ? [] : await deps.packGate(paths);
  const waiverFile = await deps.workspace.waivers();
  const { waivers, problems: read } = readWaivers(waiverFile.committed, deps.now());
  const waiverProblems = waiverFile.uncommitted ? [UNCOMMITTED_WAIVERS, ...read] : read;
  const findings = [...validation.findings, ...packs];
  return gateOf(findings, waivers, waiverProblems, deps.workspace.metadataRoot);
}
