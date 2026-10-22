import { describe, expect, it } from "bun:test";
import { type EnsureFact, readLayouts } from "@snagentic/core";
import { fakeInstance } from "../support/fake-instance";

// ADR-0042: a fact's layout is read live, by table and view, in the global domain.

const signal = new AbortController().signal;
const fact = (view: string, table = "incident"): EnsureFact => ({
  capability: "incident-relations",
  kind: "related_list",
  table,
  view,
  list: "incident_task.incident",
  note: "Incident Tasks",
});

const instance = () =>
  fakeInstance({
    sys_ui_view: [{ sys_id: "v".repeat(32), name: "sow" }],
    sys_ui_related_list: [
      { sys_id: "a".repeat(32), name: "incident", view: "Default view", sys_domain: "global" },
      { sys_id: "b".repeat(32), name: "incident", view: "v".repeat(32), sys_domain: "global" },
      { sys_id: "c".repeat(32), name: "incident", view: "Default view", sys_domain: "acme" },
    ],
    sys_ui_related_list_entry: [
      { sys_id: "e1", list_id: "a".repeat(32), related_list: "task_sla.task", position: "0" },
      { sys_id: "e2", list_id: "a".repeat(32), related_list: "task_ci.task", position: "1" },
      { sys_id: "e3", list_id: "c".repeat(32), related_list: "other.task", position: "0" },
    ],
  });

describe("reading the layouts the facts name (ADR-0042)", () => {
  it("finds the default view's container in the global domain, with its entries", async () => {
    const [state] = await readLayouts(instance().reader, [fact("Default view")], signal);
    expect(state).toEqual({
      container: "a".repeat(32),
      view: "Default view",
      entries: [
        { sysId: "e1", relatedList: "task_sla.task", position: 0 },
        { sysId: "e2", relatedList: "task_ci.task", position: 1 },
      ],
    });
  });

  it("finds another view by its name, and says when a view or a layout is not there", async () => {
    const states = await readLayouts(
      instance().reader,
      [fact("sow"), fact("missing view"), fact("Default view", "problem")],
      signal,
    );
    expect(states.map((s) => [s.container, s.view])).toEqual([
      ["b".repeat(32), "v".repeat(32)],
      [null, "missing view"],
      [null, "Default view"],
    ]);
  });
});
