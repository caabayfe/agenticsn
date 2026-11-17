import {
  type BuiltUnit,
  draftContentAgrees,
  type InstanceCopy,
  unitDigest,
  versionOf,
} from "../../authoring/index";
import type { InstanceReader } from "../../connection/index";
import { TableName } from "../../kernel/table-name";
import type { CaptureDecoder, PendingDelivery } from "../ports";
import { captureReferences } from "./capture-references";
import { type DraftSchemaCache, readDraftFlowGraph } from "./draft-flow-graph";

function newUnacknowledged(unit: BuiltUnit, pending: PendingDelivery): boolean {
  return (
    unit.head.table === "sys_hub_flow" &&
    /^[a-f0-9]{32}$/.test(unit.head.sysId) &&
    pending.operation === "create" &&
    pending.before === null &&
    pending.observed === undefined &&
    pending.verified !== true &&
    pending.digest === unitDigest(unit)
  );
}

function eligible(
  unit: BuiltUnit,
  captured: BuiltUnit,
  pending: PendingDelivery,
  copy: InstanceCopy,
): boolean {
  return (
    newUnacknowledged(unit, pending) &&
    copy.foreignRows === 0 &&
    copy.head["sys_domain"] === "global" &&
    copy.head["status"] === "draft" &&
    copy.head["active"] === "false" &&
    copy.head["master_snapshot"] === "" &&
    copy.head["latest_snapshot"] === "" &&
    captured.head.fields["status"] === "draft" &&
    captured.head.fields["active"] === "false" &&
    !captured.head.fields["master_snapshot"] &&
    !captured.head.fields["latest_snapshot"] &&
    ["flow", "subflow"].includes(copy.head["type"] ?? "") &&
    versionOf(captured.head.fields, []) === copy.version
  );
}

async function freshHead(
  reader: InstanceReader,
  copy: InstanceCopy,
  unit: BuiltUnit,
  signal: AbortSignal,
) {
  const rows = await reader.query(
    {
      table: TableName.parse("sys_hub_flow"),
      query: `sys_id=${unit.head.sysId}`,
      fields: [...new Set([...Object.keys(copy.head), "master_snapshot", "latest_snapshot"])],
      limit: 1,
      allDomains: true,
    },
    signal,
  );
  const head = rows[0];
  return head === undefined || versionOf(head, []) !== copy.version ? null : { ...copy, head };
}

// Establish ownership only, for an explicit normal create/load plan. Never certify delivery
// or publication: receipt-only recovery keeps requiring a published snapshot. A stale draft
// capture must also match independently read live children, including unexpected extra rows.
export async function reconcileDraftFlow(
  reader: InstanceReader,
  unit: BuiltUnit,
  pending: PendingDelivery,
  copy: InstanceCopy | null,
  payload: string,
  decode: CaptureDecoder,
  signal: AbortSignal,
  schemas?: DraftSchemaCache,
): Promise<PendingDelivery> {
  if (copy === null || !newUnacknowledged(unit, pending)) return pending;
  const fresh = await freshHead(reader, copy, unit, signal);
  const captured = decode(unit.updateName, payload, fresh);
  if (fresh === null || captured === null || !eligible(unit, captured.unit, pending, fresh))
    return pending;
  const references = await captureReferences(reader, unit, captured.unit, signal);
  if (!draftContentAgrees(unit, captured.unit, references)) return pending;
  const graph = await readDraftFlowGraph(reader, unit, captured.unit, fresh, signal, schemas);
  if (graph === null) return pending;
  const opened = decode(unit.updateName, payload, { ...fresh, children: graph.rows })?.live;
  if (
    opened === undefined ||
    opened === null ||
    opened.children.length !== graph.unit.children.length
  )
    return pending;
  const live = {
    ...graph.unit,
    head: { ...graph.unit.head, fields: opened.head },
    children: graph.unit.children.map((row, index) => ({
      ...row,
      fields: opened.children[index] ?? {},
    })),
  };
  if (!draftContentAgrees(unit, live, references)) return pending;
  const after = await freshHead(reader, fresh, unit, signal);
  const unchanged =
    after !== null &&
    Object.entries(fresh.head).every(([field, value]) => after.head[field] === value);
  return unchanged ? { ...pending, observed: copy.version } : pending;
}
