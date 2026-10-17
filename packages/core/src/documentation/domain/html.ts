// Text placed in HTML: escaped for element content and attribute values.
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// A value written inside a <script>: JSON that cannot close the script element.
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");
}
