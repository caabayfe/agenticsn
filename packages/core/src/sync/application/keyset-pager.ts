import { RequestTimedOutError } from "../../connection/domain/errors";
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
  readonly allDomains?: boolean;
}

export interface PagerSettings {
  readonly initialPageSize?: number;
  readonly adaptive?: boolean;
  readonly now?: () => number;
}

interface PageTimer {
  readonly report: (milliseconds: number) => void;
  readonly answered: () => void;
  durationMs(): number;
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

function requireCursorFields(listing: KeysetListing): void {
  const fields = listing.fields;
  const missing =
    fields === "all" ? [] : CURSOR_FIELDS[listing.kind].filter((field) => !fields.includes(field));
  if (missing.length > 0) {
    throw new Error(`a ${listing.kind} listing must request ${missing.join(", ")}`);
  }
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

  // Times one page. The connection reports the request's own time; a reader that doesn't is
  // timed from the call to its answer. Never the consumer's time with the rows (PERF2-05).
  private timing(): PageTimer {
    const started = this.now();
    let answeredAt = started;
    let reported: number | null = null;
    return {
      report: (milliseconds) => {
        reported = milliseconds;
      },
      answered: () => {
        answeredAt = this.now();
      },
      durationMs: () => reported ?? answeredAt - started,
    };
  }

  async *rows(listing: KeysetListing, signal: AbortSignal): AsyncGenerator<Row> {
    requireCursorFields(listing);
    let cursor: Cursor | null = null;
    let size = this.settings.initialPageSize ?? PAGE_SIZE.initial;
    // A page the client gave up on is tried once more, smaller (ADR-0053).
    let timedOut = false;
    for (;;) {
      if (signal.aborted) {
        throw new OperationCancelledError();
      }
      const timing = this.timing();
      const page = await this.page(listing, cursor, size, signal, timedOut, timing);
      if (page === "retry-smaller" || page === "timed-out") {
        timedOut ||= page === "timed-out";
        size = nextPageSize(size, { durationMs: 0, cancelled: true });
        continue;
      }
      timedOut = false;
      const last = page.at(-1);
      if (last === undefined) {
        return;
      }
      const next = cursorOf(listing.kind, last);
      if (cursor !== null && sameCursor(next, cursor)) {
        throw new PaginationStalledError(listing.table);
      }
      if (this.settings.adaptive !== false) {
        size = nextPageSize(size, { durationMs: timing.durationMs() });
      }
      yield* page;
      cursor = next;
    }
  }

  private async page(
    listing: KeysetListing,
    cursor: Cursor | null,
    size: number,
    signal: AbortSignal,
    timedOutBefore: boolean,
    timing: PageTimer,
  ): Promise<readonly Row[] | "retry-smaller" | "timed-out"> {
    try {
      const query = keysetQuery(listing, cursor);
      const domains = listing.allDomains === true ? { allDomains: true } : {};
      return await this.reader
        .query(
          {
            table: listing.table,
            query,
            fields: listing.fields,
            limit: size,
            ...domains,
            retryOnTimeout: false,
            onRequestTime: timing.report,
          },
          signal,
        )
        .finally(timing.answered);
    } catch (error) {
      if (isQuotaCancellation(error) && size > PAGE_SIZE.min) {
        return "retry-smaller";
      }
      if (error instanceof RequestTimedOutError && !timedOutBefore) {
        return "timed-out";
      }
      throw error;
    }
  }
}
