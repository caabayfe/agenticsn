import { heapStats } from "bun:jsc";
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_REDACTION,
  type InstanceReader,
  KeysetPager,
  type MirrorWriter,
  type PullStateStore,
  pullFull,
  type Row,
} from "@snagentic/core";
import { fileSpills } from "../../../src/adapters/fs/file-spill";

// A full pull of a large child table holds a page and one bucket of the spill, never the whole
// table (PERF-07, ASR-07). Measured with forced, synchronous garbage collection, so the
// numbers are the live heap and do not depend on when the collector would have run.
const ROWS = Number(process.env["SNAGENTIC_MEMORY_ROWS"] ?? 200_000);
const OWNERS = 2_000;
// Measured: ~4 MB with the spill, ~61 MB when the pull held the table and every row's sys_id.
// A page, a write buffer and a spill bucket are a few MB each, whatever the table's size.
const BOUND_MB = 20;

const LIVE = new AbortController().signal;
const sid = (n: number) => n.toString(16).padStart(32, "0");

let peak = 0;
const sample = () => {
  Bun.gc(true);
  peak = Math.max(peak, heapStats().heapSize);
};

function element(index: number): Row {
  return {
    sys_id: sid(1_000_000 + index),
    sys_ui_section: sid(index % OWNERS),
    element: `u_field_${index % 50}`,
    position: String(index % 100),
    type: "",
    sys_created_by: "admin",
    sys_created_on: "2024-01-01 00:00:00",
    sys_updated_on: "2024-01-01 00:00:00",
    sys_domain: "global",
  };
}

const sections = Array.from({ length: OWNERS }, (_, index) => ({
  sys_id: sid(index),
  sys_class_name: "sys_script",
  name: `Owner ${index}`,
  sys_scope: "global",
}));

const TABLES: Record<string, readonly Row[]> = {
  sys_db_object: [
    { sys_id: "c0", name: "sys_metadata", super_class: "" },
    { sys_id: "c1", name: "sys_script", super_class: "c0" },
  ],
  sys_scope: [{ sys_id: "global", scope: "global" }],
  sys_dictionary: [
    {
      sys_id: "d1",
      name: "sys_auth_profile_basic",
      element: "password",
      internal_type: "password2",
    },
  ],
  sys_script: sections,
};

let queries = 0;
const reader: InstanceReader = {
  query: async (query) => {
    queries += 1;
    if (queries % 40 === 0) sample();
    const after = /sys_id>([^^]+)/.exec(query.query)?.[1] ?? "";
    if (String(query.table) === "sys_ui_element") {
      const start = after === "" ? 0 : Number.parseInt(after, 16) - 1_000_000 + 1;
      const end = Math.min(ROWS, start + query.limit);
      return Array.from({ length: Math.max(0, end - start) }, (_, at) => element(start + at));
    }
    const cls = /sys_class_name=([^^]+)/.exec(query.query)?.[1];
    return (TABLES[String(query.table)] ?? [])
      .filter((row) => cls === undefined || row["sys_class_name"] === cls)
      .filter((row) => (row["sys_id"] ?? "") > after)
      .slice(0, query.limit);
  },
  stats: () => ({
    requests: 0,
    retries: 0,
    timeouts: 0,
    semaphoreWaitMs: 0,
    transactionIds: [],
    concurrencyLimit: 1,
    peakConcurrency: 1,
    requestMs: 0,
  }),
};

function discardingMirror() {
  const bases: string[] = [];
  let childRows = 0;
  let documents = 0;
  const records: MirrorWriter = {
    write: async (_root, rendered) => {
      bases.push(rendered.base);
    },
    writeDocument: async (_root, path, document) => {
      if (path.includes(".children.") && Array.isArray(document)) {
        childRows += document.length;
        documents += 1;
        if (documents % 400 === 0) sample();
      }
    },
    writeText: async () => {},
    existingFiles: async function* () {},
    move: async () => {},
    bases: async function* () {
      yield* bases;
    },
    checkpoint: async () => {},
  };
  return { records, childRows: () => childRows };
}

const state: PullStateStore = {
  readCatalog: async () => null,
  writeCatalog: async () => {},
  readCheckpoint: async () => null,
  writeCheckpoint: async () => {},
  clearCheckpoint: async () => {},
  readState: async () => null,
  writeState: async () => {},
  heldLocally: async () => false,
  noteUnchanged: async () => {},
  forgetLocalState: async () => {},
};

describe("child rows in a full pull (PERF-07)", () => {
  const folders: string[] = [];
  afterAll(async () => {
    for (const folder of folders) await rm(folder, { recursive: true, force: true });
  });

  it(`holds a page and a spill bucket, not ${ROWS} child rows, while it lists and writes them`, async () => {
    const parent = await mkdtemp(join(tmpdir(), "snagentic-memory-"));
    folders.push(parent);
    const mirror = discardingMirror();
    const deps = {
      pager: new KeysetPager(reader),
      statistics: {
        fingerprint: async () => ({ count: 1, maxUpdatedOn: "2026-10-05 11:00:00" }),
        countBy: async () => new Map(),
        count: async () => 0,
      },
      records: mirror.records,
      state,
      instanceRoot: "instances/pdi",
      metadataRoot: "meta",
      operationalRoot: "ops",
      catalogPath: ".snagentic/pdi/catalog.json",
      policy: DEFAULT_REDACTION,
      now: () => new Date("2026-10-05T12:00:00Z"),
      spills: fileSpills(parent),
    };
    sample();
    const baseline = peak;
    peak = 0;
    const summary = await pullFull(deps, LIVE);
    const growthMb = (peak - baseline) / 1024 / 1024;
    expect(summary.childRows).toBe(ROWS);
    expect(mirror.childRows()).toBe(ROWS);
    expect(growthMb).toBeLessThan(BOUND_MB);
    expect(await readdir(parent)).toEqual([]);
  }, 60_000);
});
