const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function normalizeScalarInput(
  wanted: unknown,
  held: unknown,
  allowReferenceCaption = true,
): unknown {
  if (
    !object(wanted) ||
    !object(held) ||
    !object(wanted["parameter"]) ||
    !object(held["parameter"]) ||
    wanted["parameter"]["type"] !== held["parameter"]["type"] ||
    wanted["name"] !== held["name"]
  )
    return held;
  const type = wanted["parameter"]["type"];
  const normalized = { ...held };
  if (type === "integer") {
    for (const field of ["value", "displayValue"]) {
      const value = wanted[field];
      if (typeof value === "number" && Number.isSafeInteger(value) && held[field] === String(value))
        normalized[field] = value;
    }
  }
  if (
    ["reference", "document_id"].includes(String(type)) &&
    typeof wanted["value"] === "string" &&
    (/^[a-f0-9]{32}$/.test(wanted["value"]) || /^\{\{[^{}]+\}\}$/.test(wanted["value"])) &&
    wanted["value"] === held["value"] &&
    (wanted["displayValue"] === "" || wanted["displayValue"] === wanted["value"]) &&
    typeof held["displayValue"] === "string" &&
    (allowReferenceCaption || held["displayValue"] === "")
  )
    normalized["displayValue"] = wanted["displayValue"];
  return normalized;
}
