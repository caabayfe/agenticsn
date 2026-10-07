// A branch's update sets (spec 004, D3): one batch per pull request. The platform needs one
// update set per application scope, so the batch is a global parent holding the global changes,
// with a child per other scope. The names are the link: found on the instance, they reach the
// same batch from any machine or CI.

export const GLOBAL = "global";

export function batchName(label: string): string {
  return `snagentic: ${label}`;
}

export function updateSetName(label: string, scope: string): string {
  return scope === GLOBAL ? batchName(label) : `${batchName(label)} [${scope}]`;
}

// The update sets a push of these scopes uses: the batch first, then its children.
export function batchUpdateSets(label: string, scopes: readonly string[]): string[] {
  const children = [...new Set(scopes)].filter((scope) => scope !== GLOBAL).sort();
  return [batchName(label), ...children.map((scope) => updateSetName(label, scope))];
}

// Whether an update set belongs to this branch's batch (and not, say, to "<label>2"'s).
export function inBatch(label: string, name: string): boolean {
  return name === batchName(label) || name.startsWith(`${batchName(label)} [`);
}

const DESCRIPTION = "Changes pushed by snagentic from a reviewed plan (snagentic plan_push).";

// An update set's description (`existing`, or ours when it is new), with the pull request's link
// added once known.
export function batchDescription(existing: string | null, pr?: string): string {
  const base = existing ?? DESCRIPTION;
  return pr === undefined || base.includes(pr) ? base : `${base}\nPull request: ${pr}`;
}

// The draft pull request's body: which batch holds the branch's changes, and where.
export function pullRequestBody(label: string, instanceUrl: string): string {
  const name = batchName(label);
  const list = `${instanceUrl}/sys_update_set_list.do?sysparm_query=${encodeURIComponent(`name=${name}`)}`;
  return [
    `ServiceNow update set batch \`${name}\` on ${instanceUrl}: ${list}`,
    "",
    "Opened by snagentic push. Each push from this branch goes into this batch.",
  ].join("\n");
}
