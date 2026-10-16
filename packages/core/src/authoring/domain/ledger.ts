import { SnagenticError } from "../../kernel/errors";
import { LOSS_DESCRIPTIONS, type LossId } from "./losses";

// What each development instance held when it last agreed with a project's source (ADR-0033
// item 3). Committed beside the source, so every branch carries its own.

export interface LedgerEntry {
  // The unit's digest when they agreed.
  readonly build: string;
  // The instance copy's version then (sys_mod_count and sys_updated_on of the unit's records).
  readonly instance: string;
  // Known SDK losses accepted then: what a load of this unit also sets.
  readonly losses: readonly LossId[];
}

// Instance name -> update name -> entry.
export type Ledger = ReadonlyMap<string, ReadonlyMap<string, LedgerEntry>>;

export const EMPTY_LEDGER: Ledger = new Map();

export class InvalidLedgerError extends SnagenticError {
  constructor(path: string, reason: string) {
    super(
      "invalid-ledger",
      "precondition",
      `${path} is not a valid ledger: ${reason}`,
      "restore it with git: snagentic writes this file, and it is never edited by hand",
    );
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isLoss = (value: unknown): value is LossId =>
  typeof value === "string" && Object.hasOwn(LOSS_DESCRIPTIONS, value);

function entryOf(path: string, name: string, value: unknown): LedgerEntry {
  if (
    !isRecord(value) ||
    typeof value["build"] !== "string" ||
    typeof value["instance"] !== "string"
  ) {
    throw new InvalidLedgerError(path, `entry ${name} needs build and instance`);
  }
  const losses = value["losses"] ?? [];
  if (!Array.isArray(losses) || !losses.every(isLoss)) {
    throw new InvalidLedgerError(path, `entry ${name} has an unknown loss`);
  }
  return { build: value["build"], instance: value["instance"], losses: [...losses].sort() };
}

// A ledger from its parsed document (null when the file does not exist).
export function ledgerOf(path: string, document: unknown): Ledger {
  if (document === null || document === undefined) return EMPTY_LEDGER;
  if (!isRecord(document)) throw new InvalidLedgerError(path, "expected a map of instances");
  const ledger = new Map<string, Map<string, LedgerEntry>>();
  for (const [instance, units] of Object.entries(document)) {
    if (!isRecord(units)) throw new InvalidLedgerError(path, `${instance} is not a map of units`);
    const entries = new Map<string, LedgerEntry>();
    for (const [name, value] of Object.entries(units))
      entries.set(name, entryOf(path, name, value));
    ledger.set(instance, entries);
  }
  return ledger;
}

const sorted = <T>(map: ReadonlyMap<string, T>) => [...map].sort(([a], [b]) => (a < b ? -1 : 1));

// The document a ledger is written as: sorted, so a change is a minimal diff.
export function ledgerDocument(ledger: Ledger): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    sorted(ledger).map(([instance, units]) => [
      instance,
      Object.fromEntries(
        sorted(units).map(([name, entry]) => [
          name,
          entry.losses.length === 0
            ? { build: entry.build, instance: entry.instance }
            : { build: entry.build, instance: entry.instance, losses: [...entry.losses].sort() },
        ]),
      ),
    ]),
  );
}

// The ledger with these entries set (undefined removes one) for one instance.
export function withEntries(
  ledger: Ledger,
  instance: string,
  changes: ReadonlyMap<string, LedgerEntry | undefined>,
): Ledger {
  const units = new Map(ledger.get(instance) ?? []);
  for (const [name, entry] of changes) {
    if (entry === undefined) units.delete(name);
    else units.set(name, entry);
  }
  const next = new Map(ledger);
  if (units.size === 0) next.delete(instance);
  else next.set(instance, units);
  return next;
}
