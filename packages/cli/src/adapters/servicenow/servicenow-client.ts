import {
  AccessDeniedError,
  AuthenticationFailedError,
  type ConnectionStats,
  InstanceError,
  type InstanceProfile,
  type InstanceReader,
  type InstanceWriter,
  type PluginActivator,
  type Row,
  type ServerCost,
  type ServerCostReader,
  type TableFingerprint,
  TableName,
  type TableQuery,
  type TableStatistics,
} from "@snagentic/core";
import { authorize, type RequestSender } from "./authorization";
import { CicdPluginActivator } from "./cicd-plugin-activator";
import type { HttpResponse } from "./http-types";
import { TableApiWriter } from "./table-api-writer";

const MAX_PAGE_SIZE = 10_000;

function errorMessage(body: string): string {
  try {
    const parsed: { error?: { message?: string; detail?: string } } = JSON.parse(body);
    return [parsed.error?.message, parsed.error?.detail].filter(Boolean).join(": ") || "no details";
  } catch {
    return "no details";
  }
}

interface StatsResult {
  stats?: { count?: string; max?: { sys_updated_on?: string } };
  groupby_fields?: { field?: string; value?: string }[];
}

const COST_FIELDS = [
  "response_time",
  "sql_time",
  "sql_count",
  "cpu_time",
  "business_rule_time",
  "acl_time",
  "semaphore_wait_time",
];

interface CostResult {
  stats?: {
    count?: string;
    sum?: Record<string, string | undefined>;
    max?: { response_time?: string };
  };
}

function countOf(result: StatsResult | null | undefined): number | null {
  const count = Number(result?.stats?.count);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

// The only place that builds Table API and Aggregate API requests, so ADR-0016's rules hold
// everywhere: explicit fields, raw values, no reference links, no row counts on listings.
export class ServiceNowClient implements InstanceReader, TableStatistics, ServerCostReader {
  private readonly headers: Readonly<Record<string, string>>;
  // Unique per connection, so the transaction log can tell this run's requests apart.
  private readonly userAgent: string;
  // Plugin activation through the CI/CD API, over this connection.
  readonly plugins: PluginActivator = new CicdPluginActivator(this);
  // Table API writes, for push to development instances.
  readonly writer: InstanceWriter = new TableApiWriter(this);

  // Every request goes through the scheduler, signed for the profile's auth method.
  private readonly scheduler: RequestSender;

  constructor(
    private readonly profile: InstanceProfile,
    secret: string,
    scheduler: RequestSender,
    version: string,
  ) {
    this.scheduler = authorize(profile, secret, scheduler);
    this.userAgent = `${version} run/${crypto.randomUUID().slice(0, 8)}`;
    this.headers = {
      Accept: "application/json",
      "User-Agent": this.userAgent,
    };
  }

  async query(query: TableQuery, signal: AbortSignal): Promise<readonly Row[]> {
    const fields = query.fields;
    if (fields !== "all" && (fields.length === 0 || fields.some((field) => field === ""))) {
      throw new Error("a table query must name its fields explicitly, or ask for all of them");
    }
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > MAX_PAGE_SIZE) {
      throw new Error(`limit must be between 1 and ${MAX_PAGE_SIZE}`);
    }
    const url = new URL(`/api/now/table/${query.table}`, this.profile.url);
    url.search = new URLSearchParams({
      sysparm_query: query.query,
      ...(fields === "all" ? {} : { sysparm_fields: fields.join(",") }),
      sysparm_limit: String(query.limit),
      sysparm_display_value: "false",
      sysparm_exclude_reference_link: "true",
      sysparm_no_count: "true",
    }).toString();
    const response = await this.scheduler.send(
      { method: "GET", url: url.href, headers: this.headers },
      signal,
    );
    const result = await this.result(response, `table ${query.table}`);
    if (!Array.isArray(result)) {
      throw this.unexpected(response, `table ${query.table}`);
    }
    return result as Row[];
  }

  // Count and latest raw sys_updated_on in one aggregate request.
  // Count and latest raw sys_updated_on in one aggregate request.
  async fingerprint(table: TableName, signal: AbortSignal): Promise<TableFingerprint> {
    const what = `statistics of ${table}`;
    const params = { sysparm_count: "true", sysparm_max_fields: "sys_updated_on" };
    const { response, result } = await this.aggregate(table, params, signal, what);
    const stats = result as StatsResult | null;
    const count = countOf(stats);
    if (count === null) {
      throw this.unexpected(response, what);
    }
    return { count, maxUpdatedOn: stats?.stats?.max?.sys_updated_on || null };
  }

  async count(table: TableName, query: string, signal: AbortSignal): Promise<number> {
    const what = `count of ${table}`;
    const params = { sysparm_count: "true", sysparm_query: query };
    const { response, result } = await this.aggregate(table, params, signal, what);
    const count = countOf(result as StatsResult | null);
    if (count === null) {
      throw this.unexpected(response, what);
    }
    return count;
  }

  async countBy(
    table: TableName,
    field: string,
    signal: AbortSignal,
    query?: string,
  ): Promise<ReadonlyMap<string, number>> {
    const what = `counts of ${table} by ${field}`;
    const params = {
      sysparm_count: "true",
      sysparm_group_by: field,
      ...(query === undefined ? {} : { sysparm_query: query }),
    };
    const { response, result } = await this.aggregate(table, params, signal, what);
    if (!Array.isArray(result)) {
      throw this.unexpected(response, what);
    }
    const counts = new Map<string, number>();
    for (const group of result as StatsResult[]) {
      const count = countOf(group);
      const value = group.groupby_fields?.find((entry) => entry.field === field)?.value;
      if (count === null || value === undefined) {
        throw this.unexpected(response, what);
      }
      counts.set(value, count);
    }
    return counts;
  }

  // A write with a JSON body (Table API). Never retried (the scheduler retries only GET).
  async sendJson(
    method: "POST" | "PATCH",
    path: string,
    body: Readonly<Record<string, string>>,
    what: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    const url = new URL(path, this.profile.url);
    const headers = { ...this.headers, "Content-Type": "application/json" };
    const request = { method, url: url.href, headers, body: JSON.stringify(body) };
    return this.result(await this.scheduler.send(request, signal), what);
  }

  // Any other API of the instance, as JSON: the parsed `result`, with the same error handling.
  // `path` is an absolute API path such as /api/sn_cicd/progress/<id>.
  async callApi(
    method: "GET" | "POST",
    path: string,
    what: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    const url = new URL(path, this.profile.url);
    const headers =
      method === "POST" ? { ...this.headers, "Content-Type": "application/json" } : this.headers;
    const response = await this.scheduler.send(
      { method, url: url.href, headers, ...(method === "POST" ? { body: "{}" } : {}) },
      signal,
    );
    return this.result(response, what);
  }

  private async aggregate(
    table: TableName,
    params: Record<string, string>,
    signal: AbortSignal,
    what: string,
  ): Promise<{ response: HttpResponse; result: unknown }> {
    const url = new URL(`/api/now/stats/${table}`, this.profile.url);
    url.search = new URLSearchParams(params).toString();
    const response = await this.scheduler.send(
      { method: "GET", url: url.href, headers: this.headers },
      signal,
    );
    return { response, result: await this.result(response, what) };
  }

  async serverCost(since: string, signal: AbortSignal): Promise<ServerCost> {
    const what = "statistics of syslog_transaction";
    const params = {
      sysparm_query: `sys_created_on>=${since}^user_agent=${this.userAgent}`,
      sysparm_count: "true",
      sysparm_sum_fields: COST_FIELDS.join(","),
      sysparm_max_fields: "response_time",
    };
    const table = TableName.parse("syslog_transaction");
    const { response, result } = await this.aggregate(table, params, signal, what);
    const stats = (result as CostResult | null)?.stats;
    const transactions = Number(stats?.count);
    if (!Number.isInteger(transactions)) {
      throw this.unexpected(response, what);
    }
    const sum = (field: string) => Number(stats?.sum?.[field] ?? 0) || 0;
    return {
      transactions,
      responseMs: sum("response_time"),
      maxResponseMs: Number(stats?.max?.response_time ?? 0) || 0,
      sqlMs: sum("sql_time"),
      sqlQueries: sum("sql_count"),
      cpuMs: sum("cpu_time"),
      businessRuleMs: sum("business_rule_time"),
      aclMs: sum("acl_time"),
      semaphoreWaitMs: sum("semaphore_wait_time"),
    };
  }

  stats(): ConnectionStats {
    return this.scheduler.stats();
  }

  // The parsed `result` of a successful response; undefined when the body is not JSON.
  private async result(response: HttpResponse, what: string): Promise<unknown> {
    const body = await response.text();
    if (response.status === 401) {
      throw new AuthenticationFailedError(this.profile.name);
    }
    if (response.status === 403) {
      throw new AccessDeniedError(what, errorMessage(body));
    }
    const transaction = response.headers.get("x-transaction-id") ?? "unknown";
    if (response.status < 200 || response.status >= 300) {
      throw new InstanceError(
        `${what}: HTTP ${response.status}: ${errorMessage(body)} (transaction ${transaction})`,
      );
    }
    try {
      const parsed: { result?: unknown } = JSON.parse(body);
      return parsed.result;
    } catch {
      // Hibernating instances answer with an HTML page.
      throw this.unexpected(response, what);
    }
  }

  private unexpected(response: HttpResponse, what: string): InstanceError {
    const transaction = response.headers.get("x-transaction-id") ?? "unknown";
    return new InstanceError(
      `${what}: the response was not the expected JSON (transaction ${transaction})`,
    );
  }
}
