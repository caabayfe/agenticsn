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

export function unitDigest(unit: BuiltUnit): string {
  const children = unit.children.map(stable).sort((a, b) => {
    const left = `${a["@table"]}|${a["@sys_id"]}`;
    const right = `${b["@table"]}|${b["@sys_id"]}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return sha256Hex(canonicalJson({ head: stable(unit.head), children })).slice(0, 32);
}
