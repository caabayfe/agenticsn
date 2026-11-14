import { describe, expect, it } from "bun:test";
import { type BuiltUnit, capturedContentAgrees } from "@snagentic/core";
import { compiledCopyAgrees } from "../../src/delivery/domain/capture-content";
import { flowUnit } from "./flow-fixture";

describe("captured authored content", () => {
  it("requires the live compiled chunk to agree with the captured and built JSON", () => {
    const flow = flowUnit("wanted");
    const chunk = {
      ...flow,
      children: [],
      head: {
        ...flow.head,
        table: "sys_json_chunk",
        fields: { sys_id: flow.head.sysId, payload: '{"a":1,"b":2}', version: "1" },
      },
    };
    const copy = {
      head: { ...chunk.head.fields, payload: '{"b":2,"a":1}' },
      children: [],
      version: "2|now",
      foreignRows: 0,
    };
    expect(compiledCopyAgrees(chunk, chunk, copy)).toBe(true);
    expect(
      compiledCopyAgrees(chunk, chunk, {
        ...copy,
        head: { ...copy.head, payload: '{"a":2,"b":2}' },
      }),
    ).toBe(false);
    expect(
      compiledCopyAgrees(chunk, chunk, { ...copy, head: { ...copy.head, version: "2" } }),
    ).toBe(false);
  });

  it("requires fields on composite children, even when the instance comparison tolerates missing columns", () => {
    const built: BuiltUnit = {
      updateName: "sys_choice_task_state",
      file: "choice.xml",
      head: {
        table: "sys_choice_set",
        sysId: "set1",
        action: "INSERT_OR_UPDATE",
        fields: { name: "task", element: "state" },
        referenceNames: {},
      },
      children: [
        {
          table: "sys_choice",
          sysId: "choice1",
          action: "INSERT_OR_UPDATE",
          fields: { name: "task", element: "state", value: "1", language: "en", label: "Open" },
          referenceNames: {},
        },
      ],
    };
    const missing = {
      ...built,
      children: built.children.map((row) => ({
        ...row,
        fields: { name: "task", element: "state", value: "1", language: "en" },
      })),
    };
    expect(capturedContentAgrees(built, missing)).toBe(false);
  });

  it("rejects unexpected authored graph tables and duplicate or changed child rows", () => {
    const built = flowUnit("wanted");
    const extra = {
      table: "sys_hub_trigger_instance_v2",
      sysId: "other",
      action: "INSERT_OR_UPDATE" as const,
      fields: { sys_id: "other" },
      referenceNames: {},
    };
    expect(capturedContentAgrees(built, { ...built, children: [...built.children, extra] })).toBe(
      false,
    );
    expect(
      capturedContentAgrees(built, { ...built, children: [...built.children, ...built.children] }),
    ).toBe(false);
    expect(capturedContentAgrees(built, flowUnit("different"))).toBe(false);
  });

  it("does not accept a deletion of a different record", () => {
    const built = flowUnit("wanted");
    const deletion = {
      ...built,
      head: { ...built.head, action: "DELETE" as const, fields: { sys_id: built.head.sysId } },
      children: [],
    };
    expect(
      capturedContentAgrees(deletion, {
        ...deletion,
        head: { ...deletion.head, sysId: "other", fields: { sys_id: "other" } },
      }),
    ).toBe(false);
  });
});
