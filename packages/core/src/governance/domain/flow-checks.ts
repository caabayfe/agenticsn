import type { BuiltUnit } from "../../authoring/domain/unit";

// What a flow's build says about whether it can run. Pure: the build's trigger inputs arrive
// opened (JSON), as built units read them.

export interface FlowHit {
  readonly ruleId: string;
  readonly field: string;
  readonly message: string;
}

const TRIGGER = "sys_hub_trigger_instance_v2";

// The `condition` input of a trigger's inputs, or null when it has none or they don't parse.
function conditionOf(inputs: string): string | null {
  try {
    const parsed: unknown = JSON.parse(inputs);
    if (!Array.isArray(parsed)) return null;
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) continue;
      if (Reflect.get(entry, "name") !== "condition") continue;
      const value = Reflect.get(entry, "value");
      return typeof value === "string" ? value : "";
    }
    return null;
  } catch {
    return null;
  }
}

// The platform registers a record trigger whose condition is empty but never runs its flow;
// Flow Designer writes "no condition" as '^EQ' (pdi2, spec 009 L8).
export function flowTriggerHits(unit: BuiltUnit): FlowHit[] {
  if (unit.head.table !== "sys_hub_flow" || unit.head.action === "DELETE") return [];
  return unit.children
    .filter(
      (row) => row.table === TRIGGER && (row.fields["trigger_type"] ?? "").startsWith("record_"),
    )
    .filter((row) => conditionOf(row.fields["trigger_inputs"] ?? "")?.trim() === "")
    .map(() => ({
      ruleId: "SN-MNT-018",
      field: "trigger_inputs",
      message:
        "the record trigger's condition is empty, so the flow never runs: write condition: '^EQ' to run it for every record",
    }));
}
