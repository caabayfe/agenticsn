import { type FluentInstaller, type FluentPublishResult, InstanceError } from "@snagentic/core";

// A POST body for an instance API other than the Table API (ServiceNowClient.callApi).
export interface ApiBody {
  readonly body?: string;
  readonly contentType?: string;
  // Statuses that carry an answer rather than an error.
  readonly answers?: readonly number[];
}

// The connection the installer talks through (ServiceNowClient).
export interface ApiPoster {
  callApi(
    method: "GET" | "POST",
    path: string,
    what: string,
    signal: AbortSignal,
    post?: ApiBody,
  ): Promise<unknown>;
}

const field = (value: unknown, name: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;

// The XML files as multipart "files" parts, as the SDK's installConfigurations sends them.
function multipart(files: readonly { readonly name: string; readonly content: string }[]) {
  const boundary = `snagentic-${crypto.randomUUID()}`;
  const parts = files.map(
    (file) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\n` +
      `Content-Type: application/xml\r\n\r\n${file.content}\r\n`,
  );
  return { body: `${parts.join("")}--${boundary}--\r\n`, boundary };
}

function publishResults(result: unknown): FluentPublishResult[] {
  const results = field(result, "results");
  if (!Array.isArray(results)) {
    throw new InstanceError("activate_flows: the instance answered without per-flow results");
  }
  return results.map((entry: unknown) => ({
    sysId: String(field(entry, "sys_id") ?? ""),
    published: field(entry, "status") === "success",
    message: String(field(entry, "message") ?? field(entry, "error_code") ?? ""),
  }));
}

// The ServiceNow IDE's endpoints, the ones the SDK itself calls (ADR-0028 as amended, item 7).
// Through the request scheduler, which never retries a POST (ADR-0016).
export class ApiFluentInstaller implements FluentInstaller {
  constructor(private readonly api: ApiPoster) {}

  async load(
    scopeId: string,
    files: readonly { readonly name: string; readonly content: string }[],
    updateSet: string,
    signal: AbortSignal,
  ): Promise<void> {
    const { body, boundary } = multipart(files);
    const path = `/api/fluent/load/${encodeURIComponent(scopeId)}?targetUpdateSetId=${encodeURIComponent(updateSet)}`;
    const contentType = `multipart/form-data; boundary=${boundary}`;
    const result = await this.api.callApi("POST", path, "fluent load", signal, {
      body,
      contentType,
    });
    if (field(result, "targetUpdateSetId") !== updateSet) {
      throw new InstanceError(
        `fluent load: the instance loaded into ${String(field(result, "targetUpdateSetId"))}, not the batch's update set ${updateSet}`,
      );
    }
  }

  async publish(
    scope: string,
    records: { readonly flows: readonly string[]; readonly actions: readonly string[] },
    signal: AbortSignal,
  ): Promise<readonly FluentPublishResult[]> {
    const entry = (sysId: string) => ({ sys_id: sysId, active: "", state: "" });
    const body = JSON.stringify({
      flows: records.flows.map(entry),
      actions: records.actions.map(entry),
    });
    const path = `/api/now/wfa_fluent/activate_flows?sysparm_transaction_scope=${encodeURIComponent(scope)}`;
    const result = await this.api.callApi("POST", path, "flow publish", signal, {
      body,
      answers: [422],
    });
    return publishResults(result);
  }
}
