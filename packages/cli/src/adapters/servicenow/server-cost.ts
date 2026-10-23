import type { ServerCost } from "@snagentic/core";
import { StatsResult } from "./responses";

// What the transaction log records for this client's requests (ASR-16): the Aggregate API
// request that sums it, and its answer read as a ServerCost.

const COST_FIELDS = [
  "response_time",
  "sql_time",
  "sql_count",
  "cpu_time",
  "business_rule_time",
  "acl_time",
  "semaphore_wait_time",
];

export const costParams = (since: string, userAgent: string) => ({
  sysparm_query: `sys_created_on>=${since}^user_agent=${userAgent}`,
  sysparm_count: "true",
  sysparm_sum_fields: COST_FIELDS.join(","),
  sysparm_max_fields: "response_time",
});

// The cost, or null when the answer has no transaction count.
export function costOf(result: unknown): ServerCost | null {
  const parsed = StatsResult.safeParse(result);
  if (!parsed.success) {
    return null;
  }
  const stats = parsed.data.stats;
  const transactions = Number(stats?.count);
  if (!Number.isInteger(transactions)) {
    return null;
  }
  const sum = (field: string) => Number(stats?.sum?.[field] ?? 0) || 0;
  return {
    transactions,
    responseMs: sum("response_time"),
    maxResponseMs: Number(stats?.max?.["response_time"] ?? 0) || 0,
    sqlMs: sum("sql_time"),
    sqlQueries: sum("sql_count"),
    cpuMs: sum("cpu_time"),
    businessRuleMs: sum("business_rule_time"),
    aclMs: sum("acl_time"),
    semaphoreWaitMs: sum("semaphore_wait_time"),
  };
}
