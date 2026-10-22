import type { BuiltUnit } from "../../authoring/domain/unit";

// Values the build wrote that can't be what the source meant. Pure.

export interface BuiltValueHit {
  readonly ruleId: string;
  readonly field: string;
  readonly message: string;
}

// JavaScript's string for any object: the SDK stringified one where the record holds text.
// Scripts may hold it as text (Object.prototype.toString checks), so only a whole value or a
// whole item of a list counts.
const OBJECT_STRING = "[object Object]";

const stringified = (value: string) =>
  value.split(",").some((item) => item.trim() === OBJECT_STRING);

export function serializedObjectHits(unit: BuiltUnit): BuiltValueHit[] {
  if (unit.head.action === "DELETE") return [];
  return [unit.head, ...unit.children].flatMap((row) =>
    Object.entries(row.fields)
      .filter(([, value]) => stringified(value))
      .map(([field]) => ({
        ruleId: "SN-MNT-019",
        field,
        message: `${row.table}.${field} is built as '${OBJECT_STRING}': the SDK wrote an object where the instance needs text; write the value itself (a role's name, a record's sys_id)`,
      })),
  );
}
