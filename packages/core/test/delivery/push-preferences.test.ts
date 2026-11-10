import { describe, expect, it } from "bun:test";
import { settle, switchFor } from "../../src/delivery/application/push-preferences";
import { restorePreference } from "../../src/delivery/application/push-steps";
import type { SwitchedPreference } from "../../src/delivery/ports";
import type { InstanceWriter, PushJournal, Row } from "../../src/index";
import { fakeInstance } from "../support/fake-instance";

const JOURNAL: PushJournal = {
  planId: "p",
  mirrorCommit: "",
  startedAt: "2026-11-10T09:00:00Z",
  preferences: [],
  steps: [],
};

// A session whose writes, and the journal saves around them, are logged in order.
function session(rows: Row[]) {
  const tables: Record<string, Row[]> = { sys_user_preference: rows };
  const instance = fakeInstance(tables);
  const log: string[] = [];
  const writer: InstanceWriter = {
    insert: async (table, values, signal) => {
      log.push(`insert ${values["name"]}`);
      return instance.writer.insert(table, values, signal);
    },
    update: async (table, sysId, values, signal) => {
      log.push(`update ${sysId}`);
      return instance.writer.update(table, sysId, values, signal);
    },
  };
  const journal = { current: JOURNAL };
  const saved: (readonly SwitchedPreference[])[] = [];
  const save = async (preferences: readonly SwitchedPreference[]) => {
    journal.current = { ...journal.current, preferences };
    saved.push(preferences);
    log.push(`journal ${preferences.map((p) => `${p.name}=${p.previousValue}`).join(",")}`);
  };
  return {
    tables,
    log,
    journal,
    saved,
    save,
    run: { reader: instance.reader, writer, signal: new AbortController().signal },
  };
}

describe("the preferences a push switches (REL-03)", () => {
  it("journals the preference's previous value before switching it on the instance", async () => {
    const s = session([{ sys_id: "p1", user: "u1", name: "apps.current_app", value: "x_old" }]);
    await switchFor(
      s.run,
      { user: "u1", name: "apps.current_app", value: "global" },
      s.journal,
      s.save,
    );
    expect(s.log).toEqual(["journal apps.current_app=x_old", "update p1"]);
    expect(s.journal.current.preferences).toEqual([
      { sysId: "p1", user: "u1", name: "apps.current_app", previousValue: "x_old" },
    ]);
  });

  it("journals a preference the user never had before creating it, then records the new row", async () => {
    const s = session([]);
    await switchFor(
      s.run,
      { user: "u1", name: "sys_update_set", value: "set1" },
      s.journal,
      s.save,
    );
    expect(s.log).toEqual([
      "journal sys_update_set=",
      "insert sys_update_set",
      "journal sys_update_set=",
    ]);
    expect(s.saved[0]?.[0]?.sysId).toBe("");
    const created = s.tables["sys_user_preference"]?.[0]?.["sys_id"];
    expect(s.journal.current.preferences[0]?.sysId).toBe(created);
  });

  it("restores a preference journaled before its row was created, found by user and name", async () => {
    const s = session([{ sys_id: "p9", user: "u1", name: "sys_update_set", value: "set1" }]);
    await restorePreference(s.run, {
      sysId: "",
      user: "u1",
      name: "sys_update_set",
      previousValue: "",
    });
    expect(s.log).toEqual(["update p9"]);
    expect(s.tables["sys_user_preference"]?.[0]?.["value"]).toBe("");
  });

  it("keeps in the journal a preference it could not restore, and restores the others", async () => {
    const s = session([{ sys_id: "p1", user: "u1", name: "apps.current_app", value: "global" }]);
    s.journal.current = {
      ...JOURNAL,
      preferences: [
        { sysId: "p1", user: "u1", name: "apps.current_app", previousValue: "x_old" },
        { sysId: "gone", user: "u1", name: "sys_update_set", previousValue: "set0" },
      ],
    };
    const failing = {
      ...s.run,
      writer: {
        ...s.run.writer,
        update: async (table: string, sysId: string, values: Readonly<Record<string, string>>) => {
          if (sysId === "p1") throw new Error("instance unreachable");
          return s.run.writer.update(table, sysId, values, s.run.signal);
        },
      },
    };
    await expect(settle(failing, s.journal, s.save)).rejects.toThrow("instance unreachable");
    expect(s.journal.current.preferences.map((p) => p.name)).toEqual(["apps.current_app"]);
  });
});
