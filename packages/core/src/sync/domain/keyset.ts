import type { Row } from "../../kernel/row";

// ADR-0016: every listing pages by keyset, never by offset.
//   snapshot     ordered by sys_id                      (complete listings)
//   change-feed  ordered by (sys_updated_on, sys_id)    (changes since a watermark)
export type KeysetKind = "snapshot" | "change-feed";

export interface Cursor {
  readonly sysId: string;
  readonly updatedOn?: string;
}

export interface KeysetFilter {
  readonly kind: KeysetKind;
  // Encoded query on indexed fields; repeated in every ^NQ group.
  readonly base: string;
  // change-feed only: include rows updated at or after this raw UTC timestamp.
  readonly since?: string;
}

const SNAPSHOT_ORDER = "ORDERBYsys_id";
const FEED_ORDER = "ORDERBYsys_updated_on^ORDERBYsys_id";

function group(...terms: (string | undefined)[]): string {
  return terms.filter((term): term is string => term !== undefined && term !== "").join("^");
}

function withOrder(filter: string, order: string): string {
  return filter === "" ? order : `${filter}^${order}`;
}

export function keysetQuery(filter: KeysetFilter, cursor: Cursor | null): string {
  if (filter.kind === "snapshot") {
    return withOrder(
      group(filter.base, cursor === null ? undefined : `sys_id>${cursor.sysId}`),
      SNAPSHOT_ORDER,
    );
  }
  if (cursor === null || cursor.updatedOn === undefined) {
    const since = filter.since === undefined ? undefined : `sys_updated_on>=${filter.since}`;
    return withOrder(group(filter.base, since), FEED_ORDER);
  }
  // Rows strictly after the cursor's second, OR rows in that same second after its sys_id.
  const later = group(filter.base, `sys_updated_on>${cursor.updatedOn}`);
  const sameSecond = group(
    filter.base,
    `sys_updated_on=${cursor.updatedOn}`,
    `sys_id>${cursor.sysId}`,
  );
  return `${later}^NQ${sameSecond}^${FEED_ORDER}`;
}

export function cursorOf(kind: KeysetKind, row: Row): Cursor {
  const sysId = row["sys_id"] ?? "";
  return kind === "snapshot" ? { sysId } : { sysId, updatedOn: row["sys_updated_on"] ?? "" };
}

export function sameCursor(left: Cursor, right: Cursor): boolean {
  return left.sysId === right.sysId && left.updatedOn === right.updatedOn;
}

export const PAGE_SIZE = { initial: 500, min: 100, max: 1000, targetMs: 2000 } as const;

export interface PageTiming {
  readonly durationMs: number;
  // The instance cancelled the transaction for exceeding its time quota.
  readonly cancelled?: boolean;
}

// Aims each page at ~2 s of server time: halve when slow, grow by half when fast.
export function nextPageSize(current: number, timing: PageTiming): number {
  if (timing.cancelled === true || timing.durationMs > PAGE_SIZE.targetMs * 2) {
    return Math.max(PAGE_SIZE.min, Math.floor(current / 2));
  }
  if (timing.durationMs < PAGE_SIZE.targetMs / 2) {
    return Math.min(PAGE_SIZE.max, Math.round(current * 1.5));
  }
  return current;
}
