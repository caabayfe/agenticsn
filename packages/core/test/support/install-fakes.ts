import type { InstallJournal, InstallRecord, InstallSteps, ListState } from "@snagentic/core";

// An install's steps and journal in memory: each step is recorded as a call, in order.
export function fakeSteps(
  options: {
    notApplied?: Record<string, number>;
    notTaken?: { reason: string; action: string; rows: string[] };
    refused?: Record<string, { table: string; reason: string; records: string[]; action: string }>;
    nothingFor?: string[];
    customized?: string[];
    absent?: string[];
    layout?: ListState;
  } = {},
) {
  const calls: string[] = [];
  const owned: string[] = [];
  const files = new Map<string, string>();
  const steps: InstallSteps = {
    activatePlugin: async (id) => {
      calls.push(`activate ${id}`);
      return { seconds: 3 };
    },
    refresh: async () => {
      calls.push("refresh");
    },
    add: async (modules) => {
      calls.push(`add ${modules.join("+")}`);
      return { copied: [`source/global/src/fluent/${modules.at(-1)}.now.ts`], conflicts: [] };
    },
    keys: async (paths) => {
      calls.push(`keys ${paths.length}`);
    },
    takeOver: async (records) => {
      calls.push(`take-over ${records.length}`);
      const customized = records
        .filter((r) => (options.customized ?? []).includes(r.sysId))
        .map((r) => `${r.table} ${r.sysId}`);
      const absent = records
        .filter((r) => (options.absent ?? []).includes(r.sysId))
        .map((r) => `${r.table} ${r.sysId}`);
      return {
        taken: records.length - customized.length - absent.length,
        customized,
        absent,
      };
    },
    planPush: async (label, _signal, own) => {
      calls.push(`plan ${label}`);
      owned.push(...own);
      const nothing = (options.nothingFor ?? []).some((m) => label.includes(m));
      return { planId: `p-${label}`, ready: !nothing, units: nothing ? 0 : 5, problems: [] };
    },
    push: async (planId, label) => {
      calls.push(`push ${planId}`);
      const notApplied =
        Object.entries(options.notApplied ?? {}).find(([m]) => label.includes(m))?.[1] ?? 0;
      const refused = Object.entries(options.refused ?? {})
        .filter(([m]) => label.includes(m))
        .map(([, group]) => group);
      const skipped = refused.reduce((n, g) => n + g.records.length, 0);
      return {
        units: 5,
        notApplied: notApplied + skipped,
        notCaptured: skipped,
        updateSets: [`snagentic: ${label}`],
        refused,
      };
    },
    load: async (modules) => {
      calls.push(`load ${modules.join("+")}`);
      const problems = options.notTaken === undefined ? [] : [options.notTaken];
      const skipped = options.notTaken?.rows.length ?? 0;
      return {
        entities: [
          {
            entity: "group",
            counts: { inserted: 1, updated: 0, ignored: 0, skipped, error: 0 },
            failed: options.notTaken?.rows ?? [],
            problems,
          },
        ],
        stopped: skipped > 0,
      };
    },
    completeUpdateSets: async (sets) => {
      calls.push(`complete ${sets.map((set) => set.name).join(", ")}`);
    },
    layouts: async (facts) => {
      calls.push(`layouts ${facts.length}`);
      return facts.map(
        () => options.layout ?? { container: null, view: "Default view", entries: [] },
      );
    },
    writeFile: async (path, text) => {
      files.set(path, text);
    },
    commit: async (paths) => {
      calls.push(`commit ${paths.length}`);
      return "r1";
    },
  };
  return { steps, calls, files, owned };
}

export function memoryJournal(start: InstallRecord | null = null, locked = false) {
  const state = { record: start, locked, cleared: false };
  const journal: InstallJournal = {
    read: async () => state.record,
    write: async (r) => {
      state.record = r;
    },
    clear: async () => {
      state.record = null;
      state.cleared = true;
    },
    lock: async () => !state.locked,
    unlock: async () => {},
  };
  return { journal, state };
}
