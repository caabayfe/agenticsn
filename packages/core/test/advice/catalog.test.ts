import { describe, expect, it } from "bun:test";
import {
  GUIDANCE,
  guidanceFor,
  INTENTS,
  RULES,
  recognise,
  ruleById,
  rulesFor,
} from "@snagentic/core";

describe("the advice catalog", () => {
  it("has unique, well-formed ids", () => {
    const ids = [
      ...RULES.map((r) => r.id),
      ...GUIDANCE.map((g) => g.id),
      ...INTENTS.map((i) => i.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(RULES.every((r) => /^SN-(SEC|PERF|UPG|MNT|UX)-\d{3}$/.test(r.id))).toBe(true);
    expect(GUIDANCE.every((g) => /^SN-ADV-[A-Z]{3}-\d{3}$/.test(g.id))).toBe(true);
  });

  it("cites only rules that exist", () => {
    for (const guidance of GUIDANCE) {
      for (const id of guidance.rules ?? []) {
        expect(ruleById(id)).toBeDefined();
      }
    }
  });

  it("orders every intent's options least custom first", () => {
    const rank = { configuration: 0, "low-code": 1, script: 2 };
    for (const intent of INTENTS) {
      const ranks = intent.options.map((o) => rank[o.customization]);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });
});

describe("rulesFor", () => {
  it("picks the rules for a class's scripts", () => {
    const ids = rulesFor(["sys_script_client"]).map((r) => r.id);
    expect(ids).toContain("SN-PERF-005");
    expect(ids).toContain("SN-UX-001");
    expect(ids).not.toContain("SN-PERF-001");
    expect(rulesFor(["sys_script"]).map((r) => r.id)).toContain("SN-PERF-001");
    expect(rulesFor([])).toHaveLength(RULES.length);
  });
});

describe("guidanceFor", () => {
  it("gives general guidance always, and class guidance when the class is involved", () => {
    const design = guidanceFor("design", ["sysevent_email_action"]).map((g) => g.id);
    expect(design).toContain("SN-ADV-DES-001");
    expect(design).not.toContain("SN-ADV-CLI-001");
    expect(guidanceFor("build", ["sys_script_client"]).map((g) => g.id)).toContain(
      "SN-ADV-CLI-002",
    );
  });
});

describe("recognise", () => {
  it.each([
    ["When a P1 incident is created, notify the on-call manager", "notify"],
    ["Make the cause field mandatory when the incident is resolved", "field-state"],
    ["Default the assignment group from the category", "set-value"],
    ["Prevent closing a change without a backout plan", "validate"],
    ["Send an approval to the manager for laptop requests", "approval"],
    ["Route network incidents to the network team", "assignment"],
    ["Push new incidents to Jira through their REST API", "integration"],
    ["Every night close resolved incidents older than 7 days", "schedule"],
    ["Only managers should see the salary field", "access"],
    ["Add a button to escalate the incident", "action"],
  ])("recognises %p as %p", (request, intent) => {
    expect(recognise(request).map((i) => i.id)).toContain(intent);
  });

  it("recognises nothing in an unrelated request", () => {
    expect(recognise("refactor the utilities")).toEqual([]);
  });
});
