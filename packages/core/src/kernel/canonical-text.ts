// Hash contract v1: CRLF and lone CR become LF, then every trailing LF is removed.
export function canonicalText(value: string | null): string {
  if (value === null) {
    return "";
  }
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+$/, "");
}
