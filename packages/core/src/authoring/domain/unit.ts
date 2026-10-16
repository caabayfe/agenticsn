// The unit of a load (ADR-0033): one built update file, named by its update name. The platform
// replaces a unit whole: a record, or a composite such as a list with its columns.

export type UnitAction = "INSERT_OR_UPDATE" | "DELETE";

export type Fields = Readonly<Record<string, string>>;

export interface UnitRecord {
  readonly table: string;
  readonly sysId: string;
  readonly action: UnitAction;
  // The fields the build wrote. A field it omits is unmanaged: a load leaves it as it is (S17).
  readonly fields: Fields;
  // The `name` the build gives a reference beside its value. A named view is written as a
  // placeholder sys_id that changes on every build, so views are compared by name (S16 F2).
  readonly referenceNames: Fields;
}

export interface BuiltUnit {
  // The update name, which is the built file's name without ".xml".
  readonly updateName: string;
  // The built file, relative to the build output folder.
  readonly file: string;
  // The record the unit is named after: the list of a list, the section of a section.
  readonly head: UnitRecord;
  // The rows a composite replaces with it: list columns, section elements, choices.
  readonly children: readonly UnitRecord[];
}

// The instance's copy of a unit, read live.
export interface InstanceCopy {
  readonly head: Fields;
  readonly children: readonly Fields[];
  // sys_mod_count and sys_updated_on of the head and its rows: changes whenever anyone saves
  // the unit on the instance. Recorded in the ledger to detect drift.
  readonly version: string;
  // Rows of the unit that belong to another domain (domain overrides of choices). The SDK drops
  // them (S16), and whether a load replaces them is untested: such a unit is never loaded.
  readonly foreignRows: number;
}

export function isDeletion(unit: BuiltUnit): boolean {
  return unit.head.action === "DELETE";
}
