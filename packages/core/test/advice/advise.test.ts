import { describe, expect, it } from "bun:test";
import { advise, type KnowledgeDependencies, refreshIndex } from "@snagentic/core";
import { memoryMirror, memoryStore, record } from "../support/memory-knowledge";

async function deps(): Promise<KnowledgeDependencies> {
  const store = memoryStore();
  const { mirror } = memoryMirror({
    "global/sysevent_email_action/incident-assigned--n1.yaml": record(
      "sysevent_email_action",
      "n1",
      { name: "Incident assigned", collection: "incident", event_name: "incident.assigned" },
    ),
    "global/sys_script/incident-events--b1.yaml": record("sys_script", "b1", {
      name: "incident events",
      collection: "incident",
      when: "after",
    }),
    "global/sys_ui_policy/mandatory-on-close--u1.yaml": record("sys_ui_policy", "u1", {
      short_description: "",
      name: "Mandatory on close",
      table: "incident",
    }),
  });
  await refreshIndex(store, mirror);
  return {
    store,
    files: mirror,
    catalog: { parents: { incident: "task", task: null }, scopes: {}, typedFields: {} },
    asOf: "2026-10-06 10:00:00",
    now: () => new Date("2026-10-06T12:00:00Z"),
  };
}

describe("advise", () => {
  it("offers the platform's options least custom first, with what already exists", async () => {
    const advice = await advise(await deps(), {
      intent: "When a P1 incident is created, notify the on-call manager",
      targets: ["incident"],
      phase: "design",
    });
    expect(advice.intents.map((i) => i.id)).toEqual(["notify"]);
    expect(advice.ladder.map((s) => [s.customization, s.fit])).toEqual([
      ["configuration", "likely"],
      ["low-code", "possible"],
      ["script", "last resort"],
    ]);
    expect(advice.ladder[0]?.evidence).toBe("already: 1 on incident (notify)");
    expect(advice.facts[0]?.related.map((r) => r.name)).toEqual([
      "incident events",
      "Incident assigned",
    ]);
  });

  it("gives design guidance and the design record, and no rules yet, when designing", async () => {
    const advice = await advise(await deps(), {
      intent: "notify the manager",
      targets: ["incident"],
      phase: "design",
    });
    expect(advice.guidance.map((g) => g.id)).toContain("SN-ADV-DES-001");
    expect(advice.designRecord).toContain("Option chosen:");
    expect(advice.rules).toEqual([]);
    expect(advice.next[0]).toEqual({
      tool: "describe",
      args: { target: "global/sys_script/incident-events--b1.yaml" },
    });
  });

  it("gives the rules and guidance for the classes being built", async () => {
    const advice = await advise(await deps(), {
      intent: "make the cause field mandatory",
      targets: ["incident"],
      phase: "build",
      classes: ["sys_script_client"],
    });
    expect(advice.rules.map((r) => r.id)).toContain("SN-PERF-005");
    expect(advice.guidance.map((g) => g.id)).toContain("SN-ADV-CLI-002");
    expect(advice.designRecord).toBeNull();
  });

  it("still helps when it does not recognise the request", async () => {
    const advice = await advise(await deps(), {
      intent: "tidy things up",
      targets: ["incident"],
      phase: "review",
    });
    expect(advice.ladder).toEqual([]);
    expect(advice.guidance.map((g) => g.id)).toContain("SN-ADV-REV-001");
    expect(advice.next).toEqual([{ tool: "describe", args: { target: "incident" } }]);
  });

  it("says when nothing of the kind exists yet", async () => {
    const advice = await advise(await deps(), {
      intent: "only managers can see the salary field",
      targets: ["incident"],
      phase: "design",
    });
    expect(advice.ladder[0]?.evidence).toBe("none on incident yet");
  });
});
