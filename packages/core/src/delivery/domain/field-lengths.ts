import type { BuiltUnit } from "../../authoring/domain/unit";

// The platform cuts a value longer than its field when it loads a record, without an error:
// the push then reports it as not applied as built, and the next plan refuses it (spec 011 F2,
// F14). The plan checks the built values against the instance's dictionary first (I11).

// The lengths the instance keeps, by table then field, inherited fields included.
export type FieldLengths = ReadonlyMap<string, ReadonlyMap<string, number>>;

// The field types cut to their length. Scripts and long texts are left out: their lengths are
// in the thousands, and the platform does not cut them on load.
export const CUT_TYPES = ["string", "translated_field", "translated_text"] as const;

// The longest declared length the platform cuts to. Every cut seen was a short name (40, 100
// characters); a longer string field is a text column that keeps more than it declares (pdi2:
// par_dashboard_canvas.layout declares 8,000 and shipped dashboards hold 71,666).
export const LONGEST_CUT = 4000;

export interface CutValue {
  readonly table: string;
  readonly field: string;
  readonly length: number;
  readonly max: number;
}

// Each table's lengths with those it inherits; a table's own declaration wins over a parent's.
export function inheritedLengths(
  tables: readonly string[],
  parents: ReadonlyMap<string, string>,
  declared: FieldLengths,
): FieldLengths {
  const lengthsOf = (table: string): Map<string, number> => {
    const chain: string[] = [];
    for (
      let t: string | undefined = table;
      t !== undefined && !chain.includes(t);
      t = parents.get(t)
    ) {
      chain.push(t);
    }
    return new Map(chain.reverse().flatMap((t) => [...(declared.get(t) ?? new Map())]));
  };
  return new Map(tables.map((table) => [table, lengthsOf(table)]));
}

// The values of a unit's records that the instance would cut.
export function cutValues(unit: BuiltUnit, lengths: FieldLengths): CutValue[] {
  return [unit.head, ...unit.children].flatMap((record) => {
    const limits = lengths.get(record.table);
    if (limits === undefined) return [];
    return Object.entries(record.fields).flatMap(([field, value]) => {
      const max = limits.get(field) ?? 0;
      return max > 0 && max <= LONGEST_CUT && value.length > max
        ? [{ table: record.table, field, length: value.length, max }]
        : [];
    });
  });
}

export const cutReason = (cut: CutValue) =>
  `${cut.table}.${cut.field} is ${cut.length} characters and the instance keeps ${cut.max}: it would cut the value; shorten it`;
