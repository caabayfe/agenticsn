import {
  AccessDeniedError,
  AuthenticationFailedError,
  type ConnectionStats,
  InstanceError,
  type InstanceProfile,
  type InstanceReader,
  type Row,
  type TableFingerprint,
  type TableName,
  type TableQuery,
  type TableStatistics,
} from "@snagentic/core";
import type { HttpResponse } from "./http-types";
import type { RequestScheduler } from "./request-scheduler";

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
}

// The only place that builds Table API and Aggregate API requests, so ADR-0016's rules hold
// everywhere: explicit fields, raw values, no reference links, no row counts on listings.
export class ServiceNowClient implements InstanceReader, TableStatistics {
  private readonly headers: Readonly<Record<string, string>>;

  constructor(
    private readonly profile: InstanceProfile,
    secret: string,
    private readonly scheduler: RequestScheduler,
    version: string,
  ) {
    this.headers = {
      Authorization: `Basic ${btoa(`${profile.auth.username}:${secret}`)}`,
      Accept: "application/json",
      "User-Agent": version,
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
  async fingerprint(table: TableName, signal: AbortSignal): Promise<TableFingerprint> {
    const url = new URL(`/api/now/stats/${table}`, this.profile.url);
    url.search = new URLSearchParams({
      sysparm_count: "true",
      sysparm_max_fields: "sys_updated_on",
    }).toString();
    const response = await this.scheduler.send(
      { method: "GET", url: url.href, headers: this.headers },
      signal,
    );
    const { stats } = ((await this.result(response, `statistics of ${table}`)) ??
      {}) as StatsResult;
    const count = Number(stats?.count);
    if (!Number.isInteger(count) || count < 0) {
      throw this.unexpected(response, `statistics of ${table}`);
    }
    return { count, maxUpdatedOn: stats?.max?.sys_updated_on || null };
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
