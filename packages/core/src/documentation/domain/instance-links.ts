import { escapeHtml } from "./html";

// A record's form on the instance, for a reader who wants to open what a page cites.
export function recordUrl(instanceUrl: string, table: string, sysId: string): string {
  return `${instanceUrl.replace(/\/+$/, "")}/${table}.do?sys_id=${sysId}`;
}

// The record named as code, linked to its form when the instance's address is known.
export function recordHtml(
  instanceUrl: string | undefined,
  table: string,
  sysId: string,
  text: string,
): string {
  const code = `<code>${escapeHtml(text)}</code>`;
  if (instanceUrl === undefined) return code;
  const href = escapeHtml(recordUrl(instanceUrl, table, sysId));
  return `<a href="${href}" target="_blank" rel="noopener">${code}</a>`;
}
