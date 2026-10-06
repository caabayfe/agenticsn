import { InstanceError, type InstanceWriter } from "@snagentic/core";

// The connection the writer talks through (ServiceNowClient).
export interface JsonSender {
  sendJson(
    method: "POST" | "PATCH",
    path: string,
    body: Readonly<Record<string, string>>,
    what: string,
    signal: AbortSignal,
  ): Promise<unknown>;
}

// Raw values in, and only the identity back: responses never echo the written values.
const QUERY = "?sysparm_input_display_value=false&sysparm_fields=sys_id,sys_updated_on";

function rowOf(result: unknown, what: string): Readonly<Record<string, string>> {
  if (result === null || typeof result !== "object") {
    throw new InstanceError(`${what}: the response was not a record`);
  }
  return Object.fromEntries(
    Object.entries(result).map(([key, value]) => [key, String(value ?? "")]),
  );
}

// Inserts and updates through the Table API (ADR-0007): records, update sets, preferences.
export class TableApiWriter implements InstanceWriter {
  constructor(private readonly client: JsonSender) {}

  async insert(table: string, values: Readonly<Record<string, string>>, signal: AbortSignal) {
    const what = `creating a ${table} record`;
    const path = `/api/now/table/${encodeURIComponent(table)}${QUERY}`;
    return rowOf(await this.client.sendJson("POST", path, values, what, signal), what);
  }

  async update(
    table: string,
    sysId: string,
    values: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ) {
    const what = `updating ${table} ${sysId}`;
    const path = `/api/now/table/${encodeURIComponent(table)}/${encodeURIComponent(sysId)}${QUERY}`;
    return rowOf(await this.client.sendJson("PATCH", path, values, what, signal), what);
  }
}
