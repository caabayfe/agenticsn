import type { InstanceReader, TableStatistics } from "../../connection/index";
import type { InstanceProfile } from "../../instance/index";
import { SysId } from "../../kernel/sys-id";
import type { TableName } from "../../kernel/table-name";
import {
  assertLiveQueriesAllowed,
  LiveQueryLogError,
  type LiveQueryOperation,
  liveQueryEntry,
} from "../domain/live-query-log";
import { assertReadableTable } from "../domain/query-policy";
import type { LiveQueryLog } from "../ports";
import * as reads from "./live-reads";
import { readLiveSchema } from "./live-schema";

// What a live query runs with: the instance's profile and connection, the log it is recorded
// in, and the clock that dates the entry.
export interface LiveQueryAccess {
  readonly profile: InstanceProfile;
  readonly reader: InstanceReader & TableStatistics;
  readonly log: LiveQueryLog;
  readonly clock: () => Date;
}

// The gate every live query passes before its first request (spec 016, D4): the instance allows
// live queries, the table and filter are acceptable, and the query is in the log. A query that
// cannot be recorded is refused, never run unrecorded.
async function admit(
  access: LiveQueryAccess,
  query: {
    readonly operation: LiveQueryOperation;
    readonly table: TableName;
    readonly filter?: string;
  },
): Promise<void> {
  assertLiveQueriesAllowed(access.profile);
  assertReadableTable(query.table);
  const entry = liveQueryEntry(access.profile, access.clock(), query);
  try {
    await access.log.append(entry);
  } catch {
    throw new LiveQueryLogError(access.log.path);
  }
}

type TableInput = Parameters<typeof reads.queryLiveTable>[1];
type RecordInput = Parameters<typeof reads.getLiveRecord>[1];
type AggregateInput = Parameters<typeof reads.aggregateLiveTable>[1];

export async function queryLiveTable(
  access: LiveQueryAccess,
  input: TableInput,
  signal: AbortSignal,
) {
  await admit(access, { operation: "table", table: input.table, filter: input.query });
  return reads.queryLiveTable(access.reader, input, signal);
}

export async function getLiveRecord(
  access: LiveQueryAccess,
  input: RecordInput,
  signal: AbortSignal,
) {
  const filter = `sys_id=${SysId.parse(input.sysId)}`;
  await admit(access, { operation: "record", table: input.table, filter });
  return reads.getLiveRecord(access.reader, input, signal);
}

export async function aggregateLiveTable(
  access: LiveQueryAccess,
  input: AggregateInput,
  signal: AbortSignal,
) {
  await admit(access, { operation: "aggregate", table: input.table, filter: input.query });
  return reads.aggregateLiveTable(access.reader, input, signal);
}

export async function queryLiveSchema(
  access: LiveQueryAccess,
  table: TableName,
  signal: AbortSignal,
) {
  await admit(access, { operation: "schema", table });
  return readLiveSchema(access.reader, table, signal);
}
