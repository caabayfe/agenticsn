import {
  type BuiltUnit,
  capturedContentAgrees,
  compareUnit,
  compiledCopyAgrees,
  type InstanceCopy,
  isDeletion,
  type UnitDecision,
  unitSpec,
} from "../../authoring/index";
import type { InstanceReader } from "../../connection/index";
import { TableName } from "../../kernel/table-name";
import type { CaptureDecoder, PendingDelivery } from "../ports";
import { captureReferences } from "./capture-references";
import { captureTriggerContracts } from "./capture-trigger-contracts";

// Read-only reconciliation can resolve an unknown acknowledgement. It cannot bless a
// different known remote version, or infer success from a timestamp or update name.
export async function reconcilePending(
  reader: InstanceReader,
  unit: BuiltUnit,
  pending: PendingDelivery,
  copy: InstanceCopy | null,
  decode: CaptureDecoder | undefined,
  signal: AbortSignal,
): Promise<PendingDelivery> {
  if (
    decode === undefined ||
    (pending.observed !== undefined && pending.observed !== (copy?.version ?? null))
  )
    return pending;
  const rows = await reader.query(
    {
      table: TableName.parse("sys_update_xml"),
      query: `name=${pending.captureName ?? pending.updateName}^update_set=${pending.updateSet}`,
      fields: ["payload"],
      limit: 1,
    },
    signal,
  );
  const content = decode(unit.updateName, rows[0]?.["payload"] ?? "", copy);
  if (content?.published !== true) return pending;
  const references = await captureReferences(reader, unit, content.unit, signal);
  const nativeTriggers = await captureTriggerContracts(reader, unit, signal);
  if (!capturedContentAgrees(unit, content.unit, references, nativeTriggers)) return pending;
  const applied = isDeletion(unit)
    ? copy === null
    : copy !== null &&
      (unitSpec(unit.head.table).comparable
        ? compareUnit(unit, copy).length === 0
        : compiledCopyAgrees(unit, content.unit, content.live ?? copy));
  return applied ? { ...pending, observed: copy?.version ?? null, verified: true } : pending;
}

// Recovery is receipt-only: neither an earlier verified flag nor a matching timestamp is proof.
export async function recoveryDecision(
  reader: InstanceReader,
  unit: BuiltUnit,
  pending: PendingDelivery,
  copy: InstanceCopy | null,
  decode: CaptureDecoder | undefined,
  signal: AbortSignal,
): Promise<UnitDecision> {
  const checked = await reconcilePending(
    reader,
    unit,
    { ...pending, verified: false },
    copy,
    decode,
    signal,
  );
  return checked.verified === true
    ? { kind: "record" }
    : {
        kind: "unsafe",
        reason:
          "unfinished delivery recovery requires matching live content and its original capture at an unchanged version",
      };
}
