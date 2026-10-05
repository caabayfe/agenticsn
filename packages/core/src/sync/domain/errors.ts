import { SnagenticError } from "../../kernel/errors";

export class PaginationStalledError extends SnagenticError {
  constructor(table: string) {
    super(
      "pagination-stalled",
      "remote",
      `listing ${table} stopped advancing: the instance returned the same page again`,
      "nothing was skipped silently; please report this table and instance version",
    );
  }
}
