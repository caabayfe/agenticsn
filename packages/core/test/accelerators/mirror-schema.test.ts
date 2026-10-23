import { describe, expect, it } from "bun:test";
import { type KnowledgeDependencies, mirrorSchema, refreshIndex } from "@snagentic/core";
import { memoryMirror, memoryStore, record } from "../support/memory-knowledge";

// The mirror's schema through the knowledge index (plan gap G13).

const FILES = {
  "global/sys_dictionary/incident-caller--d1.yaml": record("sys_dictionary", "d1", {
    name: "incident",
    element: "caller_id",
    internal_type: "reference",
  }),
  "global/sys_dictionary/task-number--d2.yaml": record("sys_dictionary", "d2", {
    name: "task",
    element: "number",
    internal_type: "string",
  }),
};

async function knowledge(parents: Record<string, string | null>): Promise<KnowledgeDependencies> {
  const store = memoryStore();
  const { mirror } = memoryMirror(FILES);
  await refreshIndex(store, mirror);
  return {
    store,
    files: mirror,
    catalog: { parents, scopes: {}, typedFields: {} },
    asOf: "2026-10-20 10:00:00",
    now: () => new Date("2026-10-20T12:00:00Z"),
  };
}

describe("the mirror's schema for the field check", () => {
  it("gives a table's fields with its parents', and null for a table the mirror lacks", async () => {
    const schema = mirrorSchema(() => knowledge({ incident: "task", task: null }));
    expect(await schema.ready()).toBe(true);
    expect([...((await schema.fieldsOf("incident")) ?? [])].sort()).toEqual([
      "caller_id",
      "number",
    ]);
    expect(await schema.fieldsOf("u_nowhere")).toBeNull();
  });

  it("is not ready before the first pull, and opens the index once", async () => {
    let opened = 0;
    const schema = mirrorSchema(() => {
      opened += 1;
      return knowledge({});
    });
    expect(await schema.ready()).toBe(false);
    await schema.fieldsOf("incident");
    expect(opened).toBe(1);
    // After a pull: the next question opens the index again, so it sees the new fields.
    schema.refresh();
    await schema.fieldsOf("incident");
    expect(opened).toBe(2);
  });
});
