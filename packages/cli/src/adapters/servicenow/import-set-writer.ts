import type { ImportSetWriter, ImportStatus } from "@snagentic/core";
import type { ApiPoster } from "./fluent-installer";

const STATUSES: readonly ImportStatus[] = ["inserted", "updated", "ignored", "skipped", "error"];

const field = (value: unknown, name: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;

// The Import Set API (spike S-B): POST /api/now/import/<table> transforms the row synchronously
// and answers per transform map with the target's status and sys_id. Through the request
// scheduler, which never retries a POST (ADR-0016).
export class ImportSetApiWriter implements ImportSetWriter {
  constructor(private readonly api: ApiPoster) {}

  async post(
    table: string,
    row: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): Promise<{ readonly status: ImportStatus; readonly sysId: string }> {
    const path = `/api/now/import/${encodeURIComponent(table)}`;
    const result = await this.api.callApi("POST", path, `import into ${table}`, signal, {
      body: JSON.stringify(row),
    });
    const first: unknown = Array.isArray(result) ? result[0] : undefined;
    const status = String(field(first, "status") ?? "");
    return {
      status: STATUSES.find((s) => s === status) ?? "error",
      sysId: String(field(first, "sys_id") ?? ""),
    };
  }
}
