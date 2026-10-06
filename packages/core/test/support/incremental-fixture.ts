import {
  type CatalogData,
  DEFAULT_REDACTION,
  KeysetPager,
  type PullCheckpoint,
  type PullOptions,
  pullFull,
  pullIncremental,
  type Row,
  type SyncState,
  type SyncStateStore,
} from "@snagentic/core";
import { fakeInstance } from "./fake-instance";
import { memoryMirror } from "./memory-mirror";

export const LIVE = new AbortController().signal;
export const sid = (n: number) => n.toString(16).padStart(32, "0");
export const BEFORE = "2026-10-05 09:00:00";
export const CHANGED = "2026-10-05 10:30:00";

export const RULE = `global/sys_script/one--${sid(1)}`;
export const FLOW = `global/sys_hub_flow/flow--${sid(3)}`;
export const SECTION = `global/sys_ui_section/section--${sid(4)}`;
export const WORKFLOW = `global/wf_workflow/approve--${sid(5)}`;

const meta = (n: number, table: string, name: string, extra: Row = {}): Row => ({
  sys_id: sid(n),
  sys_class_name: table,
  name,
  sys_scope: "global",
  sys_updated_on: BEFORE,
  ...extra,
});

export function instanceTables(): Record<string, Row[]> {
  const table = (n: string, name: string, parent = "c0") => ({
    sys_id: n,
    name,
    super_class: parent,
  });
  return {
    sys_db_object: [
      table("c0", "sys_metadata", ""),
      table("c1", "sys_script"),
      table("c2", "sys_hub_flow"),
      table("c3", "sys_ui_section"),
      table("c4", "wf_workflow"),
      table("c5", "sys_cred"),
    ],
    sys_scope: [{ sys_id: "global", scope: "global" }],
    sys_dictionary: [
      { sys_id: "d1", name: "sys_script", element: "script", internal_type: "script_server" },
    ],
    sys_script: [
      meta(1, "sys_script", "One", { script: "one();" }),
      meta(2, "sys_script", "Two", { script: "two();" }),
    ],
    sys_hub_flow: [meta(3, "sys_hub_flow", "Flow")],
    sys_ui_section: [meta(4, "sys_ui_section", "Section")],
    wf_workflow: [meta(5, "wf_workflow", "Approve")],
    sys_cred: [meta(6, "sys_cred", "Secret")],
    sys_hub_flow_stage: [{ sys_id: "st1", flow: sid(3), label: "Start", sys_updated_on: BEFORE }],
    sys_ui_element: [
      { sys_id: "e1", sys_ui_section: sid(4), element: "number", sys_updated_on: BEFORE },
      { sys_id: "e2", sys_ui_section: sid(4), element: "state", sys_updated_on: BEFORE },
    ],
    wf_workflow_version: [{ sys_id: "v1", workflow: sid(5), name: "v1", sys_updated_on: BEFORE }],
    wf_activity: [{ sys_id: "a1", workflow_version: "v1", name: "Begin", sys_updated_on: BEFORE }],
    // Owned through the flow's stage, as variable values usually are through flow steps.
    sys_variable_value: [
      { sys_id: "vv1", document_key: "st1", value: "a", sys_updated_on: BEFORE },
      { sys_id: "vv2", document_key: "st1", value: "b", sys_updated_on: BEFORE },
    ],
    sys_metadata_delete: [],
    v_plugin: [
      { sys_id: "p1", id: "com.snc.a", name: "A", active: "active", version: "1", scope: "global" },
      {
        sys_id: "p2",
        id: "com.snc.b",
        name: "B",
        active: "inactive",
        version: "1",
        scope: "global",
      },
    ],
  };
}

function memoryState() {
  const saved: {
    state: SyncState | null;
    checkpoint: PullCheckpoint | null;
    catalog: CatalogData | null;
  } = { state: null, checkpoint: null, catalog: null };
  const store: SyncStateStore = {
    readCatalog: async () => saved.catalog,
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

// A fully pulled instance; `incremental()` then pulls what changed since, at 11:00.
export async function pulledInstance(shape: (tables: Record<string, Row[]>) => void = () => {}) {
  const denied: string[] = [];
  const tables = instanceTables();
  shape(tables);
  const instance = fakeInstance(tables, denied);
  const { mirror, files, prepared } = memoryMirror();
  const state = memoryState();
  let now = new Date("2026-10-05T10:00:00Z");
  const deps = {
    pager: new KeysetPager(instance.reader),
    statistics: instance.reader,
    records: mirror,
    state: state.store,
    metadataRoot: "meta",
    operationalRoot: "ops",
    policy: DEFAULT_REDACTION,
    now: () => now,
  };
  const full = await pullFull(deps, LIVE);
  state.saved.state = full.next;
  return {
    tables: instance.tables,
    files,
    state,
    prepared,
    // Takes read access away from tables, as an ACL would.
    deny(...tables: string[]) {
      denied.push(...tables);
    },
    async incremental(options: PullOptions = {}) {
      now = new Date("2026-10-05T11:00:00Z");
      instance.queries.length = 0;
      instance.fingerprints.length = 0;
      instance.counted.length = 0;
      const summary = await pullIncremental(deps, "pdi", LIVE, () => {}, options);
      return {
        summary,
        queries: [...instance.queries],
        fingerprints: [...instance.fingerprints],
        counted: [...instance.counted],
      };
    },
  };
}

export function touch(row: Row | undefined, changes: Row): void {
  if (row === undefined) {
    throw new Error("no such row in the fixture");
  }
  Object.assign(row, changes, { sys_updated_on: CHANGED });
}
