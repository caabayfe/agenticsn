// What a pull reads again when the redaction policy's version is newer than the one the mirror
// was pulled with (ADR-0034 #2), so existing mirrors converge without a full pull.
export interface Rereads {
  // Metadata classes whose records are listed again whole.
  readonly classes: readonly string[];
  // Child tables listed again whole, as for a table the last pull never read.
  readonly childTables: readonly string[];
}

const BY_VERSION: Readonly<Record<number, Rereads>> = {
  // Typed property values are kept; choices of flow and action variables gained an owner.
  2: { classes: ["sys_properties"], childTables: ["sys_choice"] },
};

// State written before redaction had a version was pulled under version 1.
export const FIRST_REDACTION_VERSION = 1;

export function rereadsBetween(from: number, to: number): Rereads {
  const classes = new Set<string>();
  const childTables = new Set<string>();
  for (let version = from + 1; version <= to; version += 1) {
    for (const table of BY_VERSION[version]?.classes ?? []) classes.add(table);
    for (const table of BY_VERSION[version]?.childTables ?? []) childTables.add(table);
  }
  return { classes: [...classes], childTables: [...childTables] };
}
