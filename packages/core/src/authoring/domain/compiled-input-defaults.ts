const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const INPUT_KEYS = new Set(["name", "displayValue", "parameter", "scriptActive"]);

// Brazil adds an unassigned optional journal-field descriptor to Ask for Approval exports.
// An assignment, script, nonempty default, duplicate or unknown shape remains authored evidence.
function unassignedField(value: unknown, names: ReadonlySet<string>): boolean {
  if (!object(value) || typeof value["name"] !== "string" || names.has(value["name"])) return false;
  if (Object.keys(value).some((key) => !INPUT_KEYS.has(key))) return false;
  const parameter = value["parameter"];
  return (
    value["displayValue"] === "" &&
    value["scriptActive"] === false &&
    object(parameter) &&
    parameter["type"] === "field_name" &&
    parameter["mandatory"] === false &&
    parameter["defaultValue"] === "" &&
    parameter["name"] === value["name"]
  );
}

export function withoutUnassignedFields(wanted: unknown, held: unknown): unknown {
  if (!Array.isArray(wanted) || !Array.isArray(held)) return held;
  const names = new Set<string>();
  for (const entry of wanted) {
    if (!object(entry) || typeof entry["name"] !== "string") return held;
    names.add(entry["name"]);
  }
  return held.filter((entry: unknown) => {
    if (!unassignedField(entry, names) || !object(entry) || typeof entry["name"] !== "string")
      return true;
    names.add(entry["name"]);
    return false;
  });
}
