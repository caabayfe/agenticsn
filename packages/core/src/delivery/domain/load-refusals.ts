// fluent/load answers with its update set only. A record the platform skips (an access rule,
// a bad scope) is named in the system log alone, as "Skipping record for table T and id S -
// REASON" (pdi3, 2026-10-23): push reads those lines to say why a unit did not arrive.

export interface LoadRefusal {
  readonly table: string;
  readonly sysId: string;
  readonly reason: string;
}

const SKIPPED =
  /^Skipping record for table (\S+) and id ([0-9a-f]{32}) - (.+?)(?::\s*no thrown error)?\s*$/s;

export function refusalOf(message: string): LoadRefusal | null {
  const match = SKIPPED.exec(message);
  if (match === null) return null;
  const [, table = "", sysId = "", reason = ""] = match;
  return { table, sysId, reason: reason.trim() };
}

export interface RefusedGroup {
  readonly table: string;
  readonly reason: string;
  // The records' names, as the plan shows them.
  readonly records: readonly string[];
  readonly action: string;
}

const AGAIN = "then run the same command again";

// Tables whose create rules check an entitlement rather than a role, and how to meet it. The
// Performance Analytics rules require SNC.PAUtils.isPremium(): any active PA Premium plugin.
const ENTITLEMENTS: readonly { readonly prefix: string; readonly need: string }[] = [
  {
    prefix: "pa_",
    need: "Performance Analytics allows it only with a Performance Analytics Premium plugin active: activate com.snc.pa.premium (or declare it in the module's components)",
  },
];

function actionFor(table: string, reason: string, user: string): string {
  if (!/permission denied/i.test(reason)) {
    return `the instance refused them (${reason}): fix the cause the system log names, ${AGAIN}`;
  }
  const rule = `an access rule on ${table} does not let ${user} create these records`;
  const entitlement = ENTITLEMENTS.find((e) => table.startsWith(e.prefix));
  if (entitlement !== undefined) return `${rule}; ${entitlement.need}, ${AGAIN}`;
  return `${rule}: give ${user} the role its create rules need, or the plugin a rule's script checks, ${AGAIN}`;
}

// The refused units by table and reason, in the order they were planned.
export function refusalGroups(
  units: readonly {
    readonly table: string;
    readonly name: string;
    readonly refused: string | null;
  }[],
  user: string,
): RefusedGroup[] {
  const groups = new Map<string, { table: string; reason: string; records: string[] }>();
  for (const unit of units) {
    if (unit.refused === null) continue;
    const key = `${unit.table}\u0000${unit.refused}`;
    const group = groups.get(key) ?? { table: unit.table, reason: unit.refused, records: [] };
    group.records.push(unit.name);
    groups.set(key, group);
  }
  return [...groups.values()].map((g) => ({ ...g, action: actionFor(g.table, g.reason, user) }));
}
