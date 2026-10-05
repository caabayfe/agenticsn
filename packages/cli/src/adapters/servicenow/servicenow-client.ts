import {
  AccessDeniedError,
  AuthenticationFailedError,
  type ConnectionStats,
  InstanceError,
  type InstanceProfile,
  type InstanceReader,
  type Row,
  type TableQuery,
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

// The only place that builds Table API requests, so ADR-0016's rules hold everywhere:
// explicit fields, raw values, no reference links, no row counts.
export class ServiceNowClient implements InstanceReader {
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
    if (query.fields.length === 0 || query.fields.some((field) => field === "")) {
      throw new Error("a table query must name its fields explicitly");
    }
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > MAX_PAGE_SIZE) {
      throw new Error(`limit must be between 1 and ${MAX_PAGE_SIZE}`);
    }
    const url = new URL(`/api/now/table/${query.table}`, this.profile.url);
    url.search = new URLSearchParams({
      sysparm_query: query.query,
      sysparm_fields: query.fields.join(","),
      sysparm_limit: String(query.limit),
      sysparm_display_value: "false",
      sysparm_exclude_reference_link: "true",
      sysparm_no_count: "true",
    }).toString();
    const response = await this.scheduler.send(
      { method: "GET", url: url.href, headers: this.headers },
      signal,
    );
    return this.rows(response, `table ${query.table}`);
  }

  stats(): ConnectionStats {
    return this.scheduler.stats();
  }

  private async rows(response: HttpResponse, what: string): Promise<readonly Row[]> {
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
      if (Array.isArray(parsed.result)) {
        return parsed.result as Row[];
      }
    } catch {
      // Falls through: hibernating instances answer with an HTML page.
    }
    throw new InstanceError(
      `${what}: the response was not the expected JSON (transaction ${transaction})`,
    );
  }
}
