import { SnagenticError } from "../../kernel/errors";
import { parseLiveQuery } from "./query-policy";

export const LIVE_QUERY_LOG_FILE = "live-queries.jsonl";

// What the gate and the log read of an instance's profile; an InstanceProfile is one.
export interface LiveQueryTarget {
  readonly name: string;
  readonly kind: string;
  readonly auth: { readonly username: string };
  readonly liveQueries?: { readonly enabled: boolean };
}

export type LiveQueryOperation = "table" | "record" | "aggregate" | "schema";

// One live query, as the log keeps it: who asked what of which table and when. Field names and
// operators only: a filter's values and the rows returned are business data and are never
// recorded, and a profile holds no secret.
export interface LiveQueryEntry {
  readonly at: string;
  readonly instance: string;
  readonly kind: string;
  readonly user: string;
  readonly operation: LiveQueryOperation;
  readonly table: string;
  readonly filter: readonly { readonly field: string; readonly operator: string }[];
}

export class LiveQueriesDisabledError extends SnagenticError {
  constructor(profile: LiveQueryTarget) {
    super(
      "live-queries-disabled",
      "not-permitted",
      `live queries are off for ${profile.name}, a ${profile.kind} instance`,
      `to allow them, set live_queries: { enabled: true } in instances/${profile.name}/instance.yaml and commit it; every live query is then recorded in the workspace's local query log`,
    );
  }
}

export class LiveQueryLogError extends SnagenticError {
  constructor(path: string) {
    super(
      "live-query-log-unavailable",
      "precondition",
      `the live query was not run: it could not be recorded in ${path}`,
      `check that you can write ${path} and its folder (permissions, free space), then run the query again`,
    );
  }
}

// Development instances always allow live queries; test and production only when the
// instance's profile turns them on (spec 016, D4).
export function assertLiveQueriesAllowed(profile: LiveQueryTarget): void {
  if (profile.kind !== "development" && profile.liveQueries?.enabled !== true) {
    throw new LiveQueriesDisabledError(profile);
  }
}

export function liveQueryEntry(
  profile: LiveQueryTarget,
  at: Date,
  query: {
    readonly operation: LiveQueryOperation;
    readonly table: string;
    readonly filter?: string;
  },
): LiveQueryEntry {
  const terms = query.filter === undefined ? [] : parseLiveQuery(query.filter).flat(2);
  return {
    at: at.toISOString(),
    instance: profile.name,
    kind: profile.kind,
    user: profile.auth.username,
    operation: query.operation,
    table: query.table,
    filter: terms.map(({ field, operator }) => ({ field, operator })),
  };
}
