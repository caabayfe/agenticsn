import { type DeliveryWorkspace, KeysetPager, type Row } from "@snagentic/core";
import { governanceOf } from "./fake-governance";
import { fakeInstance } from "./fake-instance";

// A branch (feature/p1) and an instance with two open update sets: someone's (s1) and this
// branch's batch (s2). Shared by the plan and push tests.

export interface State {
  waivers: unknown | null;
  waiversUncommitted: boolean;
  // Branches published to the remote.
  published: string[];
  // Source files not committed, workspace-relative.
  uncommittedSource?: string[];
  // Commits push made (the ledger), in order.
  commits?: { paths: string[]; message: string }[];
}

function fakeWorkspace(state: State): DeliveryWorkspace {
  return {
    metadataRoot: "instances/dev/metadata",
    mirrorCommit: async () => "c0ffee",
    branch: async () => "feature/p1",
    waivers: async () => ({ committed: state.waivers, uncommitted: state.waiversUncommitted }),
    publishBranch: async (branch) => {
      state.published.push(branch);
    },
    uncommittedSource: async () => state.uncommittedSource ?? [],
    commitFiles: async (paths, message) => {
      state.commits = [...(state.commits ?? []), { paths: [...paths], message }];
      return `commit-${state.commits.length}`;
    },
  };
}

export function setup(overrides: Partial<State> = {}, held: Record<string, unknown>[] = []) {
  const state: State = { waivers: null, waiversUncommitted: false, published: [], ...overrides };
  const tables: Record<string, Row[]> = {
    sys_update_set: [
      { sys_id: "s1", name: "Someone's work", state: "in progress", application: "global" },
      { sys_id: "s2", name: "snagentic: feature/p1", state: "in progress", application: "global" },
    ],
    sys_update_xml: held.map((row) => ({ sys_id: "x", sys_updated_by: "pat", ...row })),
  };
  const fake = fakeInstance(tables);
  const deps = {
    workspace: fakeWorkspace(state),
    governance: governanceOf({}),
    updateSets: {
      pager: new KeysetPager(fake.reader),
      statistics: fake.reader,
      now: () => new Date(),
    },
    now: () => new Date("2026-10-06T12:00:00Z"),
    signal: new AbortController().signal,
  };
  return { deps, state, fake, tables };
}
