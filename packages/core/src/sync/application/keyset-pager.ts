import type { InstanceReader } from "../../connection/ports";
import { OperationCancelledError, SnagenticError } from "../../kernel/errors";
import type { Row } from "../../kernel/row";
import type { TableName } from "../../kernel/table-name";
import { PaginationStalledError } from "../domain/errors";
import {
  type Cursor,
  cursorOf,
  type KeysetFilter,
  keysetQuery,
  nextPageSize,
  PAGE_SIZE,
  sameCursor,
} from "../domain/keyset";

export interface KeysetListing extends KeysetFilter {
  readonly table: TableName;
  readonly fields: readonly string[] | "all";
}

export interface PagerSettings {
  readonly initialPageSize?: number;
  readonly adaptive?: boolean;
  readonly now?: () => number;
}

const CURSOR_FIELDS = {
  snapshot: ["sys_id"],
  "change-feed": ["sys_id", "sys_updated_on"],
} as const;

function isQuotaCancellation(error: unknown): boolean {
  return (
    error instanceof SnagenticError &&
    /transaction cancelled|maximum execution time/i.test(error.message)
  );
}

// The only way snagentic lists rows (ADR-0016). A listing ends only on an empty page, because
// ACLs remove rows after the limit is applied, so short pages are normal.
export class KeysetPager {
  private readonly now: () => number;

  constructor(
    private readonly reader: InstanceReader,
    private readonly settings: PagerSettings = {},
  ) {
    this.now = settings.now ?? (() => performance.now());
  }

  async *rows(listing: KeysetListing, signal: AbortSignal): AsyncGenerator<Row> {
    const fields = listing.fields;
    const missing =
      fields === "all"
        ? []
        : CURSOR_FIELDS[listing.kind].filter((field) => !fields.includes(field));
    if (missing.length > 0) {
      throw new Error(`a ${listing.kind} listing must request ${missing.join(", ")}`);
    }
    let cursor: Cursor | null = null;
    let size = this.settings.initialPageSize ?? PAGE_SIZE.initial;
    for (;;) {
      if (signal.aborted) {
        throw new OperationCancelledError();
      }
      const started = this.now();
      const page = await this.page(listing, cursor, size, signal);
      if (page === "retry-smaller") {
        size = nextPageSize(size, { durationMs: 0, cancelled: true });
        continue;
      }
      const last = page.at(-1);
      if (last === undefined) {
        return;
      }
      const next = cursorOf(listing.kind, last);
      if (cursor !== null && sameCursor(next, cursor)) {
        throw new PaginationStalledError(listing.table);
      }
      yield* page;
      cursor = next;
      if (this.settings.adaptive !== false) {
        size = nextPageSize(size, { durationMs: this.now() - started });
      }
    }
  }

  private async page(
    listing: KeysetListing,
    cursor: Cursor | null,
    size: number,
    signal: AbortSignal,
  ): Promise<readonly Row[] | "retry-smaller"> {
    try {
      const query = keysetQuery(listing, cursor);
      return await this.reader.query(
        { table: listing.table, query, fields: listing.fields, limit: size },
        signal,
      );
    } catch (error) {
      if (isQuotaCancellation(error) && size > PAGE_SIZE.min) {
        return "retry-smaller";
      }
      throw error;
    }
  }
}
