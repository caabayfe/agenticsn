import { canonicalJson } from "../../kernel/canonical-json";
import { sha256Hex } from "../../kernel/sha256";
import type { BuiltUnit, UnitRecord } from "./unit";
import { comparedValue, NAMED_REFERENCES } from "./values";

// A built unit's content digest: equal for two builds of the same source. Named references are
// taken by name, because the build gives them a new placeholder sys_id every time (S16 F2).
function stable(record: UnitRecord): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [field, value] of Object.entries(record.fields)) {
    fields[field] = NAMED_REFERENCES.has(field) ? `name:${comparedValue(record, field)[0]}` : value;
  }
  return { ...fields, "@table": record.table, "@sys_id": record.sysId, "@action": record.action };
}

// A Now.del by keys gets a new random sys_id on every build (S16 F3): it is named by its table
// and the keys it deletes by.
function deletionDigest(unit: BuiltUnit): string {
  const keys = Object.entries(unit.head.fields).filter(([field]) => !field.startsWith("sys_"));
  return sha256Hex(
    canonicalJson({ delete: unit.head.table, keys: Object.fromEntries(keys) }),
  ).slice(0, 32);
}

export function unitDigest(unit: BuiltUnit): string {
  if (unit.head.action === "DELETE") return deletionDigest(unit);
  const children = unit.children.map(stable).sort((a, b) => {
    const left = `${a["@table"]}|${a["@sys_id"]}`;
    const right = `${b["@table"]}|${b["@sys_id"]}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return sha256Hex(canonicalJson({ head: stable(unit.head), children })).slice(0, 32);
}
