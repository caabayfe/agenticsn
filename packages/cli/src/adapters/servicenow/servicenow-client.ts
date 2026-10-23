import {
  AccessDeniedError,
  AuthenticationFailedError,
  type ConnectionStats,
  type FluentInstaller,
  type ImportSetWriter,
  InstanceError,
  type InstanceProfile,
  type InstanceReader,
  type InstanceWriter,
  type PluginActivator,
  type Row,
  type SdkAccess,
  SdkRouteRefusedError,
  type ServerCost,
  type ServerCostReader,
  type TableFingerprint,
  TableName,
  type TableQuery,
  type TableStatistics,
} from "@snagentic/core";
import { authorize, type RequestSender } from "./authorization";
import { CicdPluginActivator } from "./cicd-plugin-activator";
import { type ApiBody, ApiFluentInstaller } from "./fluent-installer";
import type { HttpResponse } from "./http-types";
import { ImportSetApiWriter } from "./import-set-writer";
import { ErrorBody, firstIssue, GroupedStats, Rows, StatsResult } from "./responses";
import { costOf, costParams } from "./server-cost";
import { TableApiWriter } from "./table-api-writer";

const MAX_PAGE_SIZE = 10_000;

const text = (value: unknown) => (typeof value === "string" ? value : undefined);

function errorMessage(body: string): string {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return "no details";
  }
  const parsed = ErrorBody.safeParse(raw);
  if (!parsed.success) {
    return "no details";
  }
  const { error, result } = parsed.data;
  const table = [text(error?.message), text(error?.detail)].filter(Boolean).join(": ");
  return table || text(result?.error) || "no details";
}

function countOf(result: StatsResult): number | null {
  const count = Number(result.stats?.count);
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
  // Fluent builds loaded and published through the ServiceNow IDE's endpoints (ADR-0028).
  readonly fluent: FluentInstaller = new ApiFluentInstaller(this);
  // Accelerator data loads through the Import Set API (ADR-0026).
  readonly imports: ImportSetWriter = new ImportSetApiWriter(this);

  // Every request goes through the scheduler, signed for the profile's auth method.
  private readonly scheduler: RequestSender;

  constructor(
    private readonly profile: InstanceProfile,
    secret: string,
    scheduler: RequestSender,
    version: string,
    // How requests are signed: the profile's auth method, or nothing for a browser session
    // whose transport carries its own session (ADR-0024).
    sign: typeof authorize = authorize,
  ) {
    this.scheduler = sign(profile, secret, scheduler);
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
      ...(query.allDomains === true ? { sysparm_query_no_domain: "true" } : {}),
    }).toString();
    const response = await this.scheduler.send(
      { method: "GET", url: url.href, headers: this.headers },
      signal,
    );
    const rows = Rows.safeParse(await this.result(response, `table ${query.table}`));
    if (!rows.success) {
      throw this.unexpected(response, `table ${query.table}`, firstIssue(rows.error));
    }
    return rows.data;
  }

  // Count and latest raw sys_updated_on in one aggregate request.
  async fingerprint(table: TableName, signal: AbortSignal): Promise<TableFingerprint> {
    const what = `statistics of ${table}`;
    const params = { sysparm_count: "true", sysparm_max_fields: "sys_updated_on" };
    const { response, result } = await this.aggregate(table, params, signal, what);
    const stats = StatsResult.safeParse(result);
    const count = stats.success ? countOf(stats.data) : null;
    if (!stats.success || count === null) {
      throw this.unexpected(response, what);
    }
    return { count, maxUpdatedOn: stats.data.stats?.max?.["sys_updated_on"] || null };
  }

  async count(table: TableName, query: string, signal: AbortSignal): Promise<number> {
    const what = `count of ${table}`;
    const params = { sysparm_count: "true", sysparm_query: query };
    const { response, result } = await this.aggregate(table, params, signal, what);
    const stats = StatsResult.safeParse(result);
    const count = stats.success ? countOf(stats.data) : null;
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
    const groups = GroupedStats.safeParse(result);
    if (!groups.success) {
      throw this.unexpected(response, what, firstIssue(groups.error));
    }
    const counts = new Map<string, number>();
    for (const group of groups.data) {
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
    return this.result(await this.scheduler.send(request, signal), what, "write");
  }

  // Any other API of the instance: the parsed `result`, with the same error handling. `path` is
  // absolute (/api/sn_cicd/progress/<id>); a POST sends `post.body` ({} by default). Statuses in
  // `post.answers` are answers, not errors (activate_flows answers 422 with per-flow results).
  async callApi(
    method: "GET" | "POST",
    path: string,
    what: string,
    signal: AbortSignal,
    post: ApiBody = {},
  ): Promise<unknown> {
    const url = new URL(path, this.profile.url);
    const type = { "Content-Type": post.contentType ?? "application/json" };
    const headers = method === "POST" ? { ...this.headers, ...type } : this.headers;
    const body = method === "POST" ? { body: post.body ?? "{}" } : {};
    const response = await this.scheduler.send({ method, url: url.href, headers, ...body }, signal);
    return this.result(response, what, method === "POST" ? "write" : "read", post.answers);
  }

  // A request made on behalf of the embedded SDK (ADR-0032): signed and scheduled like every
  // other, answered as it came, for the SDK to read. The connector checks the route first.
  async exchange(
    request: { readonly method: "GET" | "POST"; readonly url: string; readonly body?: string },
    signal: AbortSignal,
  ): Promise<{ readonly status: number; readonly contentType: string; readonly text: string }> {
    const url = new URL(request.url, this.profile.url);
    // The request carries this client's credentials: it never leaves the instance's origin.
    if (url.origin !== new URL(this.profile.url).origin) {
      throw new SdkRouteRefusedError(request.method, url.href);
    }
    const type = request.method === "POST" ? { "Content-Type": "application/json" } : {};
    const body = request.body === undefined ? {} : { body: request.body };
    const send = { method: request.method, url: url.href, headers: { ...this.headers, ...type } };
    const response = await this.scheduler.send({ ...send, ...body }, signal);
    const contentType = response.headers.get("content-type") ?? "application/json";
    return { status: response.status, contentType, text: await response.text() };
  }

  // The embedded SDK's way to the instance (ADR-0032), bound to a use case's signal.
  sdkAccess(signal: AbortSignal): SdkAccess {
    return { host: this.profile.url, exchange: (request) => this.exchange(request, signal) };
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
    const table = TableName.parse("syslog_transaction");
    const params = costParams(since, this.userAgent);
    const { response, result } = await this.aggregate(table, params, signal, what);
    const cost = costOf(result);
    if (cost === null) {
      throw this.unexpected(response, what);
    }
    return cost;
  }

  stats(): ConnectionStats {
    return this.scheduler.stats();
  }

  // The parsed `result` of a successful response; undefined when the body is not JSON.
  private async result(
    response: HttpResponse,
    what: string,
    access: "read" | "write" = "read",
    answers: readonly number[] = [],
  ): Promise<unknown> {
    const body = await response.text();
    if (response.status === 401) {
      throw new AuthenticationFailedError(this.profile.name);
    }
    if (response.status === 403) {
      throw new AccessDeniedError(what, errorMessage(body), access);
    }
    const transaction = response.headers.get("x-transaction-id") ?? "unknown";
    if ((response.status < 200 || response.status >= 300) && !answers.includes(response.status)) {
      throw new InstanceError(
        `${what}: HTTP ${response.status}: ${errorMessage(body)} (transaction ${transaction})`,
      );
    }
    try {
      const parsed: unknown = JSON.parse(body);
      return parsed !== null && typeof parsed === "object"
        ? Reflect.get(parsed, "result")
        : undefined;
    } catch {
      // Hibernating instances answer with an HTML page.
      throw this.unexpected(response, what);
    }
  }

  private unexpected(response: HttpResponse, what: string, issue?: string): InstanceError {
    const transaction = response.headers.get("x-transaction-id") ?? "unknown";
    const at = issue === undefined ? "" : `, at ${issue}`;
    return new InstanceError(
      `${what}: the response was not the expected JSON${at} (transaction ${transaction})`,
    );
  }
}
