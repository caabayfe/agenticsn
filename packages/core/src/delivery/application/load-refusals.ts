import type { InstanceReader } from "../../connection/ports";
import { OperationCancelledError, SnagenticError } from "../../kernel/errors";
import { formatRawTimestamp } from "../../kernel/raw-timestamp";
import { TableName } from "../../kernel/table-name";
import { KeysetPager } from "../../sync/application/keyset-pager";
import { refusalOf } from "../domain/load-refusals";

// The instance's clock and ours differ by seconds; the window starts a little before the load.
const CLOCK_MARGIN_MS = 120_000;

// The reasons the platform logged for skipping these records since `since`, by sys_id. Read
// only after a load that left records missing (ADR-0016: a push that arrives reads no log),
// on the indexed creation time. A log the user may not read leaves the reasons unknown.
export async function readRefusals(
  reader: InstanceReader,
  since: Date,
  sysIds: ReadonlySet<string>,
  signal: AbortSignal,
): Promise<ReadonlyMap<string, string>> {
  const reasons = new Map<string, string>();
  const from = formatRawTimestamp(since.getTime() - CLOCK_MARGIN_MS);
  const listing = {
    kind: "snapshot" as const,
    table: TableName.parse("syslog"),
    base: `sys_created_on>=${from}^level=2^source=com.glide.ui.ServletErrorListener`,
    fields: ["sys_id", "message"],
  };
  try {
    for await (const row of new KeysetPager(reader).rows(listing, signal)) {
      const refusal = refusalOf(row["message"] ?? "");
      if (refusal !== null && sysIds.has(refusal.sysId)) reasons.set(refusal.sysId, refusal.reason);
    }
  } catch (error) {
    if (error instanceof OperationCancelledError || !(error instanceof SnagenticError)) throw error;
  }
  return reasons;
}
