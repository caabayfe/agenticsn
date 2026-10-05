import { describe, expect, it } from "bun:test";
import {
  AccessDeniedError,
  type ConnectionStats,
  DEFAULT_REDACTION,
  type InstanceReader,
  KeysetPager,
  type PullCheckpoint,
  pullFull,
  type RecordStore,
  type RenderedRecord,
  type Row,
  type StoredRecord,
  type SyncState,
  type SyncStateStore,
  type TableQuery,
} from "@snagentic/core";

const LIVE = new AbortController().signal;
const STATS: ConnectionStats = {
  requests: 0,
  retries: 0,
  semaphoreWaitMs: 0,
  transactionIds: [],
  concurrencyLimit: 2,
};
const sid = (n: number) => n.toString(16).padStart(32, "0");

// The instance: catalog tables, metadata classes, child and operational tables.
function instance(extra: Record<string, Row[]> = {}, denied: string[] = []) {
  const data: Record<string, Row[]> = {
    sys_db_object: [
      { sys_id: "c0", name: "sys_metadata", super_class: "" },
      { sys_id: "c1", name: "sys_script", super_class: "c0" },
      { sys_id: "c2", name: "wf_workflow", super_class: "c0" },
      { sys_id: "c3", name: "sys_cred", super_class: "c0" },
    ],
    sys_scope: [{ sys_id: "global", scope: "global" }],
    sys_dictionary: [
      { sys_id: "d1", name: "sys_script", element: "script", internal_type: "script_server" },
    ],
    sys_script: [
      {
        sys_id: sid(1),
        sys_class_name: "sys_script",
        name: "One",
        script: "a();",
        sys_scope: "global",
      },
      {
        sys_id: sid(2),
        sys_class_name: "sys_script",
        name: "Two",
        script: "b();",
        sys_scope: "global",
      },
      { sys_id: "bad/id", sys_class_name: "sys_script", name: "Broken" },
    ],
    wf_workflow: [
      { sys_id: sid(3), sys_class_name: "wf_workflow", name: "Approve", sys_scope: "global" },
    ],
    wf_workflow_version: [{ sys_id: sid(10), workflow: sid(3), name: "v1" }],
    wf_activity: [{ sys_id: sid(11), workflow_version: sid(10), name: "Begin", password: "x" }],
    v_plugin: [
      {
        sys_id: "p1",
        id: "com.b",
        name: "B",
        active: "active",
        version: "1",
        parent: "",
        extra: "ignored",
      },
      { sys_id: "p2", id: "com.a", name: "A", active: "inactive", version: "2", parent: "" },
    ],
    ...extra,
  };
  const queries: TableQuery[] = [];
  const reader: InstanceReader = {
    query: async (query) => {
      queries.push(query);
      if (denied.includes(query.table)) {
        throw new AccessDeniedError(`table ${query.table}`, "Insufficient rights");
      }
      const after = /sys_id>([^^]+)/.exec(query.query)?.[1] ?? "";
      const cls = /sys_class_name=([^^]+)/.exec(query.query)?.[1];
      return (data[query.table] ?? [])
        .filter((row) => cls === undefined || row["sys_class_name"] === cls)
        .filter((row) => (row["sys_id"] ?? "") > after)
        .sort((a, b) => ((a["sys_id"] ?? "") < (b["sys_id"] ?? "") ? -1 : 1))
        .slice(0, query.limit);
    },
    stats: () => STATS,
  };
  return { reader, queries };
}

function memoryRecords() {
  const written = new Map<string, RenderedRecord>();
  const documents = new Map<string, unknown>();
  const store: RecordStore = {
    write: async (_root, rendered) => {
      written.set(rendered.base, rendered);
    },
    writeDocument: async (root, path, document) => {
      documents.set(`${root}|${path}`, document);
    },
    remove: async () => {},
    read: async () => null,
    list: async function* (): AsyncGenerator<StoredRecord> {},
    bases: async function* () {
      yield* written.keys();
    },
  };
  return { store, written, documents };
}

function memoryState(checkpoint: PullCheckpoint | null = null) {
  const saved: { state: SyncState | null; checkpoint: PullCheckpoint | null; catalog: unknown } = {
    state: null,
    checkpoint,
    catalog: null,
  };
  const store: SyncStateStore = {
    readCatalog: async () => null,
    writeCatalog: async (data) => {
      saved.catalog = data;
    },
    readCheckpoint: async () => saved.checkpoint,
    writeCheckpoint: async (value) => {
      saved.checkpoint = value;
    },
    clearCheckpoint: async () => {
      saved.checkpoint = null;
    },
    readState: async () => saved.state,
    writeState: async (value) => {
      saved.state = value;
    },
  };
  return { store, saved };
}

function run(reader: InstanceReader, state = memoryState(), records = memoryRecords()) {
  const deps = {
    pager: new KeysetPager(reader),
    records: records.store,
    state: state.store,
    metadataRoot: "meta",
    operationalRoot: "ops",
    policy: DEFAULT_REDACTION,
    now: () => new Date("2026-10-05T12:00:00Z"),
  };
  return { result: pullFull(deps, LIVE), records, state };
}

describe("pullFull", () => {
  it("writes every record of every class in the flat layout and reports what it did", async () => {
    const { result, records } = run(instance().reader);
    const summary = await result;
    expect([...records.written.keys()].sort()).toEqual([
      `global/sys_script/one--${sid(1)}`,
      `global/sys_script/two--${sid(2)}`,
      `global/wf_workflow/approve--${sid(3)}`,
    ]);
    expect(summary).toMatchObject({
      classes: 3,
      records: 3,
      skippedRows: 1,
      unreadable: [],
      watermark: "2026-10-05 12:00:00",
    });
  });

  it("asks each class for whole records of that class only, never a parent with child rows", async () => {
    const { reader, queries } = instance();
    await run(reader).result;
    const script = queries.find((query) => query.table === "sys_script");
    expect(script?.query).toStartWith("sys_class_name=sys_script");
    expect(script?.fields).toBe("all");
    expect(queries.some((query) => query.table === "sys_cred")).toBe(false);
  });

  it("records a class it may not read and carries on", async () => {
    const summary = await run(instance({}, ["wf_workflow"]).reader).result;
    expect(summary.unreadable).toEqual(["wf_workflow"]);
    expect(summary.records).toBe(2);
  });

  it("resumes from a checkpoint without reading completed classes again, keeping the original start", async () => {
    const { reader, queries } = instance();
    const state = memoryState({
      startedAt: "2026-10-05 11:00:00",
      completedClasses: ["sys_script"],
      records: 2,
    });
    const summary = await run(reader, state).result;
    expect(queries.some((query) => query.table === "sys_script")).toBe(false);
    expect(summary).toMatchObject({ resumedClasses: 1, watermark: "2026-10-05 11:00:00" });
    expect(state.saved.checkpoint).toBeNull();
    expect(state.saved.state).toEqual({
      watermark: "2026-10-05 11:00:00",
      lastFullPull: "2026-10-05 11:00:00",
    });
  });

  it("attaches nested child rows to their owning record, without secret fields", async () => {
    const { result, records } = run(instance().reader);
    const summary = await result;
    const activity = records.documents.get(
      `meta|global/wf_workflow/approve--${sid(3)}.children.wf_activity.yaml`,
    );
    expect(activity).toEqual([{ sys_id: sid(11), workflow_version: sid(10), name: "Begin" }]);
    expect(summary.childRows).toBe(2);
  });

  it("writes operational tables with their curated fields, ordered by key", async () => {
    const { result, records } = run(instance().reader);
    await result;
    expect(records.documents.get("ops|v_plugin.yaml")).toEqual([
      { id: "com.a", name: "A", active: "inactive", version: "2", parent: "" },
      { id: "com.b", name: "B", active: "active", version: "1", parent: "" },
    ]);
  });

  it("reports unreadable child and operational tables and carries on", async () => {
    const summary = await run(instance({}, ["wf_activity", "sys_store_app"]).reader).result;
    expect(summary.unreadable).toEqual(["wf_activity", "sys_store_app"]);
    expect(summary.operationalRows).toBe(2);
  });

  it("stores the catalog for later incremental pulls", async () => {
    const { result, state } = run(instance().reader);
    await result;
    expect(state.saved.catalog).toMatchObject({ parents: { sys_script: "sys_metadata" } });
  });
});
