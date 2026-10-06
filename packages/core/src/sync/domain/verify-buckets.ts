// pull --verify compares record counts per scope, then per sys_id prefix, and lists sys_ids
// only where counts differ (ADR-0016, verification appendix).

// A part holding at most this many records is listed rather than split further: listing them
// takes about as many pages as splitting takes count requests (16).
export const LIST_LIMIT = 16_000;
// When more sub-parts than this differ, the difference is spread out (typically rows hidden
// from this user), and listing them costs less than splitting each further.
export const SPREAD_LIMIT = 4;
// sys_ids are 32 hex characters; deeper prefixes than this are listed whatever their size.
export const MAX_PREFIX = 4;
const HEX = "0123456789abcdef";

export interface MirroredRecord {
  readonly scope: string;
  readonly sysId: string;
}

// ADR-0017: [domains/<domain>/]<scope>/<class>/<slug>--<sys_id>
export function mirroredRecord(base: string): MirroredRecord | null {
  const parts = base.split("/");
  const local = parts[0] === "domains" ? parts.slice(2) : parts;
  const [scope, , leaf] = local;
  const separator = leaf?.lastIndexOf("--") ?? -1;
  if (scope === undefined || leaf === undefined || local.length !== 3 || separator < 0) {
    return null;
  }
  return { scope, sysId: leaf.slice(separator + 2) };
}

// The 16 prefixes one character longer than `prefix`.
export function childPrefixes(prefix: string): string[] {
  return [...HEX].map((character) => `${prefix}${character}`);
}

// Legacy sys_ids (such as "Default view") start with other characters. The instance compares
// case-insensitively, so an id belongs under a prefix whatever its case.
export function hasPrefix(sysId: string, prefix: string): boolean {
  return sysId.slice(0, prefix.length).toLowerCase() === prefix;
}

export function isHexPrefixed(sysId: string, length: number): boolean {
  return [...sysId.slice(0, length).toLowerCase()].every((character) => HEX.includes(character));
}

export type VerifyStep = "agree" | "list" | "split";

// `hidden` is how many counted rows this user could not list when the part was last listed.
export function verifyStep(
  instanceCount: number,
  hidden: number,
  mirroredCount: number,
  prefix: string,
): VerifyStep {
  if (instanceCount - hidden === mirroredCount) {
    return "agree";
  }
  return instanceCount <= LIST_LIMIT || prefix.length >= MAX_PREFIX ? "list" : "split";
}

// Rows counted but not listable, remembered per listed part: "<scope>|<prefix>" -> rows.
export type HiddenCounts = Readonly<Record<string, number>>;

export const hiddenKey = (scope: string, prefix: string) => `${scope}|${prefix}`;

// Hidden rows remembered for a part and everything under it.
export function hiddenUnder(hidden: HiddenCounts, scope: string, prefix: string): number {
  const key = hiddenKey(scope, prefix);
  return Object.entries(hidden)
    .filter(([stored]) => stored.startsWith(key))
    .reduce((sum, [, rows]) => sum + rows, 0);
}

// The previous counts, with every part listed now replaced by what its listing found.
export function mergeHidden(previous: HiddenCounts, listed: HiddenCounts): Record<string, number> {
  const relisted = Object.keys(listed);
  const kept = Object.entries(previous).filter(
    ([stored]) => !relisted.some((key) => stored.startsWith(key)),
  );
  return Object.fromEntries(
    [...kept, ...Object.entries(listed)]
      .filter(([, rows]) => rows > 0)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}

export interface ListDifference {
  // On the instance, missing from the mirror: class by sys_id.
  readonly missing: ReadonlyMap<string, string>;
  // In the mirror, gone from the instance.
  readonly extra: readonly string[];
}

export function compareListing(
  instance: ReadonlyMap<string, string>,
  mirrored: Iterable<string>,
): ListDifference {
  const mirroredIds = new Set(mirrored);
  const missing = new Map([...instance].filter(([sysId]) => !mirroredIds.has(sysId)));
  const extra = [...mirroredIds].filter((sysId) => !instance.has(sysId)).sort();
  return { missing, extra };
}
