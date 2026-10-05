const MAX_SLUG_LENGTH = 60;

// Lowercase ASCII words joined by "-", at most 60 characters (v1 rule, used in paths).
export function slug(value: string): string {
  const joined = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return joined.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "") || "record";
}
