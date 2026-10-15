import {
  type InstanceReader,
  type TableAttributes,
  type TableDictionary,
  TableName,
} from "@snagentic/core";

// Indexed lookups by name: one request per table of the dictionary for each batch (ADR-0016).
const BATCH = 50;

// Each table's parent and collection attributes, read from sys_db_object and sys_dictionary.
export class InstanceTableDictionary implements TableDictionary {
  constructor(private readonly reader: InstanceReader) {}

  async tables(names: readonly string[], signal: AbortSignal): Promise<TableAttributes[]> {
    const tables: TableAttributes[] = [];
    for (let i = 0; i < names.length; i += BATCH) {
      tables.push(...(await this.batch(names.slice(i, i + BATCH), signal)));
    }
    return tables;
  }

  private async batch(names: readonly string[], signal: AbortSignal) {
    const query = (table: string, filter: string, fields: string[]) =>
      this.reader.query(
        { table: TableName.parse(table), query: filter, fields, limit: names.length * 2 },
        signal,
      );
    const list = names.join(",");
    const objects = await query("sys_db_object", `nameIN${list}`, ["name", "super_class.name"]);
    const collections = await query("sys_dictionary", `nameIN${list}^internal_type=collection`, [
      "name",
      "attributes",
    ]);
    const attributes = new Map(
      collections.map((row) => [row["name"] ?? "", row["attributes"] ?? ""]),
    );
    return objects.map((row) => ({
      name: row["name"] ?? "",
      parent: row["super_class.name"] ?? "",
      attributes: attributes.get(row["name"] ?? "") ?? "",
    }));
  }
}
