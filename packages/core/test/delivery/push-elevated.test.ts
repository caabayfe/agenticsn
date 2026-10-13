import { describe, expect, it } from "bun:test";
import {
  computePlan,
  type ElevatedSessions,
  type PushDependencies,
  type PushJournal,
  push,
  type Row,
} from "@snagentic/core";
import { RULE, record, type State, setup } from "../support/delivery-fixture";
import { memoryWriter } from "../support/fake-instance";

// ADR-0024: ACLs are written through a session elevated to security_admin, opened by push
// once the branch's update set is the user's current one, and closed before it is restored.
const ACL_ID = "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0";
const ACL = `global/sys_security_acl/incident_read--${ACL_ID}`;
const RULE_ID = "0123456789abcdef0123456789abcdef";
const acl = record("sys_security_acl", ACL_ID, {
  name: "incident",
  operation: "read",
  type: "record",
});

function memoryJournal() {
  let stored: PushJournal | null = null;
  return {
    read: async () => stored,
    write: async (journal: PushJournal) => {
      stored = journal;
    },
    clear: async () => {
      stored = null;
    },
  };
}

const currentUpdateSet = (tables: Record<string, Row[]>) =>
  (tables["sys_user_preference"] ?? []).find((row) => row["name"] === "sys_update_set")?.[
    "value"
  ] ?? "";

// An elevated session over the same tables; `events` records what happened, in order.
function elevatedSessions(
  tables: Record<string, Row[]>,
  calls: string[],
  events: string[],
  options: { user?: string; failSignIn?: boolean; failClose?: boolean } = {},
): ElevatedSessions {
  return {
    open: async () => {
      events.push(`open while current update set is ${currentUpdateSet(tables) || "none"}`);
      if (options.failSignIn === true) {
        throw new Error("sign-in failed");
      }
      const writer = memoryWriter(tables, calls);
      return {
        username: options.user ?? "admin",
        writer: {
          insert: (table, values, signal) => {
            events.push(`elevated insert ${table}`);
            return writer.insert(table, values, signal);
          },
          update: (table, sysId, values, signal) => {
            events.push(`elevated update ${table}`);
            return writer.update(table, sysId, values, signal);
          },
        },
        close: async () => {
          events.push("close");
          if (options.failClose === true) {
            throw new Error("sign-out failed");
          }
        },
      };
    },
  };
}

function elevatedSetup(
  overrides: Partial<State> = {},
  options: { elevation?: boolean; user?: string; failSignIn?: boolean; failClose?: boolean } = {},
) {
  const edited = record("sys_script", RULE_ID, { name: "Rule", order: "200" }, "a();");
  const base = setup({
    working: { [RULE]: edited, [ACL]: acl },
    changed: [`${RULE}.yaml`, `${ACL}.yaml`],
    ...overrides,
  });
  base.tables["sys_user"] = [{ sys_id: "u1", user_name: "admin" }];
  base.tables["sys_script"] = [
    {
      sys_id: RULE_ID,
      sys_class_name: "sys_script",
      sys_scope: "global",
      name: "Rule",
      order: "100",
      script: "a();",
    },
  ];
  const calls: string[] = [];
  const events: string[] = [];
  const writer = memoryWriter(base.tables, calls);
  const tracked = {
    insert: (table: string, values: Readonly<Record<string, string>>, signal: AbortSignal) => {
      events.push(`insert ${table}`);
      return writer.insert(table, values, signal);
    },
    update: (
      table: string,
      sysId: string,
      values: Readonly<Record<string, string>>,
      signal: AbortSignal,
    ) => {
      events.push(
        table === "sys_user_preference" ? `preference ${values["value"]}` : `update ${table}`,
      );
      return writer.update(table, sysId, values, signal);
    },
  };
  const elevation = options.elevation ?? true;
  const deps: PushDependencies = {
    ...base.deps,
    elevation,
    elevatedSessions: elevation ? elevatedSessions(base.tables, calls, events, options) : null,
    reader: base.fake.reader,
    writer: tracked,
    journal: memoryJournal(),
    catalog: { parents: {}, scopes: {}, typedFields: {} },
    username: "admin",
    url: "https://dev.example.com",
    pullRequests: {
      find: async () => ({ kind: "none" }),
      defaultBranch: async () => "main",
      openDraft: async () => "",
    },
  };
  return { ...base, deps, calls, events };
}

const QUERY = { instance: "dev", allowCollisions: false, confirm: true };

describe("planning ACLs (ADR-0024)", () => {
  it("refuses ACLs unless a person opted the instance into elevated writes", async () => {
    const { deps } = elevatedSetup({}, { elevation: false });
    const { plan } = await computePlan(deps, QUERY);
    expect(plan.ready).toBe(false);
    expect(plan.problems).toEqual([
      {
        path: `${ACL}.yaml`,
        reason: expect.stringContaining("snagentic auth login <instance> --allow-elevation"),
      },
    ]);
  });

  it("plans ACLs on an opted-in instance, marked elevated and written after everything else", async () => {
    const { deps } = elevatedSetup();
    const { plan } = await computePlan(deps, QUERY);
    expect(plan.ready).toBe(true);
    expect(plan.changes.map((c) => [c.table, c.elevated])).toEqual([
      ["sys_script", false],
      ["sys_security_acl", true],
    ]);
  });
});

describe("pushing ACLs through an elevated session (ADR-0024)", () => {
  it("signs in once the branch's update set is current, writes the ACL elevated, then closes and restores", async () => {
    const { deps, events, tables } = elevatedSetup();
    const { plan } = await computePlan(deps, QUERY);
    const result = await push(deps, { ...QUERY, planId: plan.planId });
    expect(events).toEqual([
      "insert sys_user_preference",
      "insert sys_user_preference",
      "open while current update set is s2",
      "update sys_script",
      "elevated insert sys_security_acl",
      "close",
      "preference ",
      "preference ",
    ]);
    expect(result.written).toEqual([
      expect.objectContaining({ table: "sys_script", elevated: false, captured: true }),
      expect.objectContaining({ table: "sys_security_acl", elevated: true, captured: true }),
    ]);
    expect(tables["sys_security_acl"]).toEqual([
      expect.objectContaining({ sys_id: ACL_ID, name: "incident", sys_scope: "global" }),
    ]);
  });

  it("restores the user's preferences even when signing out fails, then reports it", async () => {
    const { deps, events } = elevatedSetup({}, { failClose: true });
    const { plan } = await computePlan(deps, QUERY);
    await expect(push(deps, { ...QUERY, planId: plan.planId })).rejects.toThrow("sign-out failed");
    expect(events.slice(-3)).toEqual(["close", "preference ", "preference "]);
  });

  it("never opens an elevated session for a plan without ACLs", async () => {
    const { deps, events } = elevatedSetup({ changed: [`${RULE}.yaml`] });
    const { plan } = await computePlan(deps, QUERY);
    await push(deps, { ...QUERY, planId: plan.planId });
    expect(events.filter((e) => e.startsWith("open"))).toEqual([]);
  });

  it("writes nothing when signing in fails, and restores the user's update set", async () => {
    const { deps, events } = elevatedSetup({}, { failSignIn: true });
    const { plan } = await computePlan(deps, QUERY);
    await expect(push(deps, { ...QUERY, planId: plan.planId })).rejects.toThrow("sign-in failed");
    expect(events).toEqual([
      "insert sys_user_preference",
      "insert sys_user_preference",
      "open while current update set is s2",
      "preference ",
      "preference ",
    ]);
  });

  it("refuses a session signed in as another user, before writing anything", async () => {
    const { deps, events } = elevatedSetup({}, { user: "someone" });
    const { plan } = await computePlan(deps, QUERY);
    await expect(push(deps, { ...QUERY, planId: plan.planId })).rejects.toMatchObject({
      code: "elevated-user-mismatch",
      message: expect.stringContaining("someone"),
    });
    expect(events).toEqual([
      "insert sys_user_preference",
      "insert sys_user_preference",
      "open while current update set is s2",
      "close",
      "preference ",
      "preference ",
    ]);
  });

  it("refuses to push ACLs when no elevated session can be opened", async () => {
    const { deps } = elevatedSetup();
    const { plan } = await computePlan(deps, QUERY);
    await expect(
      push({ ...deps, elevatedSessions: null }, { ...QUERY, planId: plan.planId }),
    ).rejects.toMatchObject({ code: "elevation-unavailable" });
  });
});
