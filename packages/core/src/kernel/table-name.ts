import type { Brand } from "./brand";
import { InvalidIdentifierError } from "./errors";

export type TableName = Brand<string, "TableName">;

const TABLE_NAME_PATTERN = /^[a-z0-9_$]+$/;

export const TableName = {
  is(value: string): value is TableName {
    return TABLE_NAME_PATTERN.test(value);
  },
  parse(value: string): TableName {
    if (TableName.is(value)) {
      return value;
    }
    throw new InvalidIdentifierError("invalid-table-name", value);
  },
};
