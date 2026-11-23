import { describe, expect, it } from "bun:test";
import {
  abandonPending,
  NoPendingDeliveryError,
  PushConfirmationRequiredError,
  type PushJournal,
} from "@snagentic/core";

// push --abandon-pending as a use case, on in-memory ports (ADR-0050, amendment A1). It has
// no instance port: what it cannot reach, it cannot write.

const RECEIPT = {
  project: "source/x_app",
  updateName: "sys_script_include_a",
  digest: "d1",
  updateSet: "set1",
  before: "1|2026-10-16 06:30:48",
  operation: "load" as const,
  removes: null,
};

const journalOf = (extra: Partial<PushJournal>): PushJournal => ({
  planId: "plan1",
  mirrorCommit: "",
  startedAt: "2026-11-21T10:00:00.000Z",
  instance: "dev",
  url: "https://dev.example",
  label: "feature/p1",
  preferences: [],
  steps: [],
  ...extra,
});

function setup(initial: PushJournal | null, commitFailure?: string) {
  const state: { journal: PushJournal | null; messages: string[] } = {
    journal: initial,
    messages: [],
  };
  const deps = {
    url: "https://dev.example",
    journal: {
      read: async () => state.journal,
      write: async (journal: PushJournal) => {
        state.journal = journal;
      },
      clear: async () => {
        state.journal = null;
      },
    },
    workspace: {
      commitRecord: async (message: string) => {
        if (commitFailure !== undefined) throw new Error(commitFailure);
        state.messages.push(message);
        return "c1";
      },
    },
  };
  return { deps, state };
}

const QUERY = { instance: "dev", planId: "plan1", confirm: true };

describe("abandoning a pending delivery", () => {
  it("says for each unit whether it was verified, written or of unknown outcome", async () => {
    const { deps, state } = setup(
      journalOf({
        pending: [
          { ...RECEIPT, updateName: "a", observed: "2|x", verified: true },
          { ...RECEIPT, updateName: "b", observed: "2|x", verified: false },
          { ...RECEIPT, updateName: "c", operation: "create", before: null },
        ],
      }),
    );
    const result = await abandonPending(deps, QUERY);
    expect(result.abandoned?.map((unit) => [unit.updateName, unit.outcome])).toEqual([
      ["a", "verified"],
      ["b", "unverified"],
      ["c", "unknown"],
    ]);
    expect(state.messages).toEqual([
      [
        "chore(snagentic): abandon pending delivery of push plan1 to dev",
        "",
        "Nothing was rolled back. No ledger changed. What stays on the instance:",
        "- load a: applied and captured, not recorded in the ledger; update set set1 https://dev.example/sys_update_set.do?sys_id=set1",
        "- load b: written, not verified as built and captured; update set set1 https://dev.example/sys_update_set.do?sys_id=set1",
        "- create c: outcome unknown, it may have been written; update set set1 https://dev.example/sys_update_set.do?sys_id=set1",
      ].join("\n"),
    ]);
    expect(state.journal).toBeNull();
    expect(result.next).toEqual([{ tool: "plan_push", args: { instance: "dev" } }]);
  });

  it("abandons a legacy journal, whose steps did not record their update set", async () => {
    const { deps, state } = setup(
      journalOf({
        steps: [{ operation: "update", table: "sys_script", sysId: "s1", state: "written" }],
      }),
    );
    const result = await abandonPending(deps, QUERY);
    expect(result.abandoned).toEqual([
      {
        project: "",
        updateName: "sys_script:s1",
        operation: "update",
        outcome: "unverified",
        updateSet: "",
        link: "",
      },
    ]);
    expect(state.messages[0]).toContain("update set not recorded");
    expect(state.journal).toBeNull();
  });

  it("keeps the preferences a stopped push switched, for the next push to restore", async () => {
    const preference = { sysId: "p1", user: "u1", name: "apps.current_app", previousValue: "x" };
    const { deps, state } = setup(journalOf({ pending: [RECEIPT], preferences: [preference] }));
    const result = await abandonPending(deps, QUERY);
    expect(state.journal).toMatchObject({ pending: [], steps: [], preferences: [preference] });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("the next push restores them");
  });

  it("refuses without confirmation, listing what would stay, and changes nothing", async () => {
    const { deps, state } = setup(journalOf({ pending: [RECEIPT] }));
    const error = await abandonPending(deps, { ...QUERY, confirm: false }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PushConfirmationRequiredError);
    expect(error).toMatchObject({
      code: "push-confirmation-required",
      message:
        "abandoning this delivery rolls nothing back and needs explicit confirmation; what stays on the instance:\n  load sys_script_include_a: outcome unknown, it may have been written; update set set1 https://dev.example/sys_update_set.do?sys_id=set1",
    });
    expect(state.messages).toEqual([]);
    expect(state.journal?.pending).toEqual([RECEIPT]);
  });

  it("refuses when nothing is pending: no journal, or only preferences to restore", async () => {
    for (const journal of [null, journalOf({ pending: [] }), journalOf({})]) {
      const { deps } = setup(journal);
      await expect(abandonPending(deps, QUERY)).rejects.toBeInstanceOf(NoPendingDeliveryError);
    }
  });

  it("keeps the journal when the record cannot be committed", async () => {
    const { deps, state } = setup(journalOf({ pending: [RECEIPT] }), "index.lock exists");
    await expect(abandonPending(deps, QUERY)).rejects.toThrow("index.lock exists");
    expect(state.journal?.pending).toEqual([RECEIPT]);
  });

  it("refuses delivery options, which it would otherwise silently ignore", async () => {
    const { deps, state } = setup(journalOf({ pending: [RECEIPT] }));
    for (const option of [{ recoverPending: true }, { draftPr: true }, { pr: "https://x/1" }]) {
      await expect(abandonPending(deps, { ...QUERY, ...option })).rejects.toMatchObject({
        code: "invalid-input",
      });
    }
    expect(state.journal?.pending).toEqual([RECEIPT]);
  });
});
