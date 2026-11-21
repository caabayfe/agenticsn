import { type Finding, type ValidateDependencies, validate } from "../../governance/index";
import { brief, type GateResult, gateOf } from "../domain/gate";
import { acceptedWaivers } from "../domain/waivers";
import type { DeliveryWorkspace } from "../ports";

// What the gate reads: validate's dependencies, the accelerator check, the waivers.
export interface GateDependencies {
  readonly governance: ValidateDependencies;
  readonly packGate?: (
    paths: readonly string[],
    units: readonly { readonly project: string; readonly sysId: string }[],
  ) => Promise<readonly Finding[]>;
  readonly workspace: Pick<DeliveryWorkspace, "waivers" | "reviewedWaivers" | "metadataRoot">;
  // Team mode (ADR-0058): the git remote of the profile's shared mirror (ADR-0052). The gate then
  // accepts only waivers on that remote's default branch. Absent: solo mode.
  readonly reviewedRemote?: string;
  readonly now: () => Date;
}

// validate over the change, plus the accelerator packs' check, with the accepted waivers applied.
// `paths` are the projects the push would load, each checked whatever the change since `commit`
// touched. `bases` holds each project's ledger commit: what it already held there is inherited,
// shown and never blocking (decision D); null for a project that never agreed with the instance.
export async function gateFor(
  deps: GateDependencies,
  commit: string,
  paths: readonly string[],
  bases: Readonly<Record<string, string | null>> = {},
  // The planned units' records: the accelerator check blocks only modules whose records they are.
  units: readonly { readonly project: string; readonly sysId: string }[] = [],
): Promise<GateResult> {
  const validation = await validate(deps.governance, { base: commit, include: paths, bases });
  const packs = deps.packGate === undefined ? [] : await deps.packGate(paths, units);
  const reviewed =
    deps.reviewedRemote === undefined
      ? null
      : await deps.workspace.reviewedWaivers(deps.reviewedRemote);
  const { waivers, problems } = acceptedWaivers(
    await deps.workspace.waivers(),
    reviewed,
    deps.now(),
  );
  const findings = [...validation.findings, ...packs];
  const gate = gateOf(findings, waivers, problems, deps.workspace.metadataRoot);
  return { ...gate, inherited: validation.inherited.map(brief) };
}
