import {
  type ChangedRecords,
  type DeliveryWorkspace,
  KeysetPager,
  type PlanDependencies,
  type PushJournal,
  type RecordFiles,
  type Row,
  recordHash,
  type ScriptChecker,
} from "@snagentic/core";
import { fakeInstance } from "./fake-instance";

// A workspace with one business rule pulled (RULE) and edited, and an instance with two open
// update sets: someone's (s1) and this branch's batch (s2). Shared by the plan and push tests.
export const RULE = "global/sys_script/rule--0123456789abcdef0123456789abcdef";
export const NEW = "global/sys_script_include/util--fedcba9876543210fedcba9876543210";

export function record(
  className: string,
  sysId: string,
  fields: Record<string, string>,
  script?: string,
  scope = "global",
): RecordFiles {
  const all = script === undefined ? fields : { ...fields, script };
  return {
    document: {
      _meta: {
        sys_class_name: className,
        sys_id: sysId,
        scope,
        hash: recordHash(className, all),
      },
      ...fields,
    },
    files: script === undefined ? [] : [{ field: "script", content: `${script}\n` }],
  };
}

export interface State {
  mirror: Record<string, RecordFiles>;
  working: Record<string, RecordFiles>;
  changed: string[];
  integrated: boolean;
  texts: Record<string, string>;
  waivers: unknown;
  waiversUncommitted: boolean;
  // Files with changes not committed on the branch, relative to the metadata root.
  uncommitted: string[];
  // Branches published to the remote.
  published: string[];
  // A push that stopped part way.
  journal: PushJournal | null;
}

function fakeWorkspace(state: State): DeliveryWorkspace {
  return {
    metadataRoot: "instances/dev/metadata",
    mirrorCommit: async () => (Object.keys(state.mirror).length === 0 ? null : "c0ffee"),
    includes: async () => state.integrated,
    branch: async () => "feature/p1",
    changedFiles: async () => state.changed,
    read: async (base, at) => (at === null ? state.working : state.mirror)[base] ?? null,
    recordsIn: async (folder, at) =>
      Object.keys(at === null ? state.working : state.mirror).filter(
        (base) => base.slice(0, base.lastIndexOf("/")) === folder,
      ),
    text: async (path) => state.texts[path] ?? null,
    waivers: async () => ({ committed: state.waivers, uncommitted: state.waiversUncommitted }),
    uncommittedFiles: async () => state.uncommitted,
    publishBranch: async (branch) => {
      state.published.push(branch);
    },
  };
}

// validate's view: the same records; the checker reports eval() as SN-SEC-001.
function governance(state: State) {
  const records: ChangedRecords = {
    resolve: async () => "c0ffee",
    changedSince: async () => [...new Set(state.changed.map((p) => p.replace(/\..*$/, "")))],
    current: async (base) => {
      const stored = state.working[base];
      const script = stored?.files[0]?.content ?? "";
      return stored === undefined
        ? null
        : {
            className: "sys_script_include",
            scope: "global",
            fields: { description: "d", script },
            files: { script: `${base}.script.js` },
          };
    },
    at: async (_commit, base) =>
      state.mirror[base] === undefined
        ? null
        : {
            className: "sys_script_include",
            scope: "global",
            fields: { description: "d" },
            files: {},
          },
  };
  const checker: ScriptChecker = {
    check: (source) => ({
      parsed: true,
      hits: source.includes("eval(") ? [{ ruleId: "SN-SEC-001", line: 1, message: "eval" }] : [],
    }),
  };
  return { records, checker };
}

export function setup(overrides: Partial<State> = {}, held: Record<string, unknown>[] = []) {
  const state: State = {
    mirror: {
      [RULE]: record(
        "sys_script",
        "0123456789abcdef0123456789abcdef",
        { name: "Rule", order: "100" },
        "a();",
      ),
    },
    working: {
      [RULE]: record(
        "sys_script",
        "0123456789abcdef0123456789abcdef",
        { name: "Rule", order: "200" },
        "a();",
      ),
    },
    changed: [`${RULE}.yaml`],
    integrated: true,
    texts: {},
    waivers: null,
    waiversUncommitted: false,
    uncommitted: [],
    published: [],
    journal: null,
    ...overrides,
  };
  const tables: Record<string, Row[]> = {
    sys_update_set: [
      { sys_id: "s1", name: "Someone's work", state: "in progress", application: "global" },
      {
        sys_id: "s2",
        name: "snagentic: feature/p1",
        state: "in progress",
        application: "global",
      },
    ],
    sys_update_xml: held.map((row) => ({ sys_id: "x", sys_updated_by: "pat", ...row })),
  };
  const fake = fakeInstance(tables);
  const deps: PlanDependencies = {
    workspace: fakeWorkspace(state),
    governance: governance(state),
    updateSets: {
      pager: new KeysetPager(fake.reader),
      statistics: fake.reader,
      now: () => new Date(),
    },
    journal: { read: async () => state.journal },
    now: () => new Date("2026-10-06T12:00:00Z"),
    signal: new AbortController().signal,
  };
  return { deps, state, fake, tables };
}
