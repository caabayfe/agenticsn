import { compareUnit } from "../../authoring/domain/compare";
import { type BuiltUnit, type InstanceCopy, isDeletion } from "../../authoring/domain/unit";
import { unitSpec } from "../../authoring/domain/unit-specs";
import type { InstanceReader } from "../../connection/ports";
import { TableName } from "../../kernel/table-name";
import { capturedContentAgrees, compiledCopyAgrees } from "../domain/capture-content";
import type { CaptureDecoder, PendingDelivery } from "../ports";
import { captureReferences } from "./capture-references";

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
  if (!capturedContentAgrees(unit, content.unit, references)) return pending;
  const applied = isDeletion(unit)
    ? copy === null
    : copy !== null &&
      (unitSpec(unit.head.table).comparable
        ? compareUnit(unit, copy).length === 0
        : compiledCopyAgrees(unit, content.unit, content.live ?? copy));
  return applied ? { ...pending, observed: copy?.version ?? null, verified: true } : pending;
}
