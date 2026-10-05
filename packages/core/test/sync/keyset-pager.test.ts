import { describe, expect, it } from "bun:test";
import {
  type ConnectionStats,
  InstanceError,
  type InstanceReader,
  KeysetPager,
  type Row,
  TableName,
  type TableQuery,
} from "@snagentic/core";
import fc from "fast-check";

const LIVE = new AbortController().signal;
const STATS: ConnectionStats = {
  requests: 0,
  retries: 0,
  semaphoreWaitMs: 0,
  transactionIds: [],
  concurrencyLimit: 2,
};
const TABLE = TableName.parse("sys_metadata");

interface FakeRow {
  sys_id: string;
  sys_updated_on: string;
  visible: boolean;
}

// A table that evaluates the pager's encoded queries the way the Table API does: filter,
// order, apply the limit, then drop rows hidden by ACLs. `onPage` can change data mid-run.
function fakeTable(
  rows: FakeRow[],
  onPage: (page: number) => void = () => {},
): InstanceReader & { pages: number } {
  const matches = (row: FakeRow, group: string): boolean =>
    group.split("^").every((term) => {
      const [, field, op, value] = /^(sys_id|sys_updated_on)(>=|>|=)(.*)$/.exec(term) ?? [];
      if (field === undefined || value === undefined) {
        return true;
      }
      const actual = row[field as "sys_id" | "sys_updated_on"];
      return op === ">" ? actual > value : op === ">=" ? actual >= value : actual === value;
    });
  const reader = {
    pages: 0,
    query: async (query: TableQuery) => {
      onPage(reader.pages);
      reader.pages += 1;
      const [filter = ""] = query.query.split("^ORDERBY");
      const groups = filter.split("^NQ");
      const byUpdate = query.query.includes("ORDERBYsys_updated_on");
      const key = (row: FakeRow) => (byUpdate ? `${row.sys_updated_on}|${row.sys_id}` : row.sys_id);
      return rows
        .filter((row) => groups.some((group) => matches(row, group)))
        .sort((a, b) => (key(a) < key(b) ? -1 : 1))
        .slice(0, query.limit)
        .filter((row) => row.visible)
        .map(({ sys_id, sys_updated_on }): Row => ({ sys_id, sys_updated_on }));
    },
    stats: () => STATS,
  };
  return reader;
}

async function collect(
  pager: KeysetPager,
  spec: Parameters<KeysetPager["rows"]>[0],
): Promise<Row[]> {
  const rows: Row[] = [];
  for await (const row of pager.rows(spec, LIVE)) {
    rows.push(row);
  }
  return rows;
}

// True when some page-size window, in the listing's own order, holds only hidden rows.
function hasAllHiddenPage(
  rows: FakeRow[],
  kind: "snapshot" | "change-feed",
  pageSize: number,
): boolean {
  const key = (row: FakeRow) =>
    kind === "snapshot" ? row.sys_id : `${row.sys_updated_on}|${row.sys_id}`;
  const order = [...rows].sort((a, b) => (key(a) < key(b) ? -1 : 1));
  return order.some((_, index) => !order.slice(index, index + pageSize).some((row) => row.visible));
}

const SPEC = { table: TABLE, fields: ["sys_id", "sys_updated_on"] } as const;
const id = (index: number) => index.toString(16).padStart(32, "0");
const second = (index: number) => `2026-10-01 00:00:${String(index % 60).padStart(2, "0")}`;

describe("KeysetPager", () => {
  it("returns every visible row exactly once, however pages are cut", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ second: fc.nat(5), visible: fc.boolean() }), { maxLength: 300 }),
        fc.integer({ min: 1, max: 40 }),
        async (generated, pageSize) => {
          const rows = generated.map((row, index) => ({
            sys_id: id(index),
            sys_updated_on: second(row.second),
            visible: row.visible,
          }));
          const pager = new KeysetPager(fakeTable(rows), {
            initialPageSize: pageSize,
            adaptive: false,
          });
          for (const kind of ["snapshot", "change-feed"] as const) {
            // Known Table API limit (ADR-0016): ACLs remove rows after the limit, so a page of
            // hidden rows only looks like the end. That case is covered by fingerprints.
            if (hasAllHiddenPage(rows, kind, pageSize)) {
              continue;
            }
            const listed = await collect(pager, {
              ...SPEC,
              kind,
              base: "",
              since: "2026-01-01 00:00:00",
            });
            const expected = rows
              .filter((row) => row.visible)
              .map((row) => row.sys_id)
              .sort();
            expect(listed.map((row) => row["sys_id"]).sort()).toEqual(expected);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it("with the next overlapped run, returns every row updated during a change feed in its latest version", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 1, max: 25 }),
        fc.array(fc.nat(199), { maxLength: 40 }),
        async (count, pageSize, touched) => {
          const rows = Array.from({ length: count }, (_, index) => ({
            sys_id: id(index),
            sys_updated_on: second(index % 7),
            visible: true,
          }));
          const updates = touched.filter((index) => index < count);
          // Each page, one row is updated: its timestamp jumps ahead, possibly into the
          // cursor's own second with a smaller sys_id, which keyset paging cannot see this run.
          // Updates happen only during the first run: an update during run N is guaranteed to
          // be returned by run N+1, so the second run must see a quiet instance.
          let firstRun = true;
          const reader = fakeTable(rows, (page) => {
            const target = firstRun ? rows[updates[page] ?? -1] : undefined;
            if (target !== undefined) {
              target.sys_updated_on = "2026-10-01 01:00:00";
            }
          });
          const pager = new KeysetPager(reader, { initialPageSize: pageSize, adaptive: false });
          const first = await collect(pager, {
            ...SPEC,
            kind: "change-feed",
            base: "",
            since: "2026-01-01 00:00:00",
          });
          firstRun = false;
          const watermark =
            first
              .map((row) => row["sys_updated_on"] ?? "")
              .sort()
              .at(-1) ?? "";
          // ADR-0016: the next pull starts at watermark minus the overlap (10 minutes).
          const overlapStart =
            watermark === "2026-10-01 01:00:00" ? "2026-10-01 00:50:00" : watermark;
          const second_ = await collect(pager, {
            ...SPEC,
            kind: "change-feed",
            base: "",
            since: overlapStart,
          });
          const latest = new Map(
            [...first, ...second_].map((row) => [row["sys_id"], row["sys_updated_on"]]),
          );
          expect([...latest.keys()].sort()).toEqual(rows.map((row) => row.sys_id).sort());
          for (const row of rows) {
            expect(latest.get(row.sys_id)).toBe(row.sys_updated_on);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it("raises PaginationStalledError when the server ignores the cursor", async () => {
    const stuck: InstanceReader = {
      query: async () => [{ sys_id: id(1), sys_updated_on: second(1) }],
      stats: () => STATS,
    };
    const listing = collect(new KeysetPager(stuck, { initialPageSize: 10, adaptive: false }), {
      ...SPEC,
      kind: "snapshot",
      base: "",
    });
    await expect(listing).rejects.toMatchObject({ code: "pagination-stalled" });
  });

  it("refuses a listing whose fields omit the cursor fields", async () => {
    const listing = collect(new KeysetPager(fakeTable([])), {
      ...SPEC,
      fields: ["name"],
      kind: "change-feed",
      base: "",
    });
    await expect(listing).rejects.toThrow(/sys_updated_on/);
  });

  it("stops between pages when the run is cancelled", async () => {
    const cancellation = new AbortController();
    const rows = Array.from({ length: 50 }, (_, index) => ({
      sys_id: id(index),
      sys_updated_on: second(index),
      visible: true,
    }));
    const pager = new KeysetPager(fakeTable(rows), { initialPageSize: 10, adaptive: false });
    const seen: Row[] = [];
    const run = async () => {
      for await (const row of pager.rows(
        { ...SPEC, kind: "snapshot", base: "" },
        cancellation.signal,
      )) {
        seen.push(row);
        cancellation.abort();
      }
    };
    await expect(run()).rejects.toMatchObject({ code: "cancelled" });
    expect(seen.length).toBe(10);
  });

  it("retries with a smaller page when the instance cancels a slow transaction", async () => {
    const sizes: number[] = [];
    const quota: InstanceReader = {
      query: async (query) => {
        sizes.push(query.limit);
        if (sizes.length === 1) {
          throw new InstanceError(
            "table t: HTTP 500: Transaction cancelled: maximum execution time exceeded",
          );
        }
        return [];
      },
      stats: () => STATS,
    };
    await collect(new KeysetPager(quota, { initialPageSize: 800 }), {
      ...SPEC,
      kind: "snapshot",
      base: "",
    });
    expect(sizes).toEqual([800, 400]);
  });

  it("does not retry other errors", async () => {
    const failing: InstanceReader = {
      query: async () => {
        throw new InstanceError("table t: HTTP 500: boom");
      },
      stats: () => STATS,
    };
    const listing = collect(new KeysetPager(failing), { ...SPEC, kind: "snapshot", base: "" });
    await expect(listing).rejects.toMatchObject({ code: "instance-error" });
  });

  it("adapts the page size to how long pages take", async () => {
    const sizes: number[] = [];
    let now = 0;
    const slow: InstanceReader = {
      query: async (query) => {
        sizes.push(query.limit);
        now += 6000;
        return sizes.length < 3 ? [{ sys_id: id(sizes.length), sys_updated_on: second(1) }] : [];
      },
      stats: () => STATS,
    };
    await collect(new KeysetPager(slow, { initialPageSize: 800, now: () => now }), {
      ...SPEC,
      kind: "snapshot",
      base: "",
    });
    expect(sizes).toEqual([800, 400, 200]);
  });
});
