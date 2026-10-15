import { recordAddress } from "../../metadata/domain/record-layout";
import type { PlanProblem } from "../domain/change";
import { type ListFiles, listChange, type PlannedList } from "../domain/list-changes";
import { DEFAULT_VIEW, type ListLayout } from "../domain/list-layout";
import type { DeliveryWorkspace } from "../ports";
import { parsed, pulledBase } from "./plan-records";

const COLUMNS = ".children.sys_ui_list_element.yaml";
const LIST_FILE = /(^|\/)sys_ui_list\/[^/]+\.yaml$/;
const VIEWS = "global/sys_ui_view";

// A list record's file or its columns file: planned as one list (ADR-0029), never as records
// or rows.
export const isListFile = (path: string) => LIST_FILE.test(path);

const listBase = (path: string) =>
  path.endsWith(COLUMNS) ? path.slice(0, -COLUMNS.length) : path.replace(/\.yaml$/, "");

async function filesAt(
  workspace: DeliveryWorkspace,
  base: string,
  at: string | null,
): Promise<ListFiles | null> {
  const record = await parsed(workspace, base, at);
  return record === null
    ? null
    : { record, rows: await workspace.document(`${base}${COLUMNS}`, at) };
}

// The list's view, as the update names it: the Default view by its sys_id, which is literally
// "Default view"; any other by its sys_id and its name, read from the mirror, or from the working
// tree when this push creates it.
async function viewOf(
  workspace: DeliveryWorkspace,
  files: ListFiles,
  commit: string,
): Promise<ListLayout["view"] | string> {
  const sysId = files.record.artifact.fields["view"] ?? "";
  if (sysId === DEFAULT_VIEW || sysId === "") {
    return { sysId: DEFAULT_VIEW, name: "" };
  }
  for (const at of [commit, null]) {
    const base = (await workspace.recordsIn(VIEWS, at)).find(
      (b) => recordAddress(b)?.sysId === sysId,
    );
    const view = base === undefined ? null : await parsed(workspace, base, at);
    if (view !== null) {
      return { sysId, name: view.artifact.fields["name"] ?? "" };
    }
  }
  return `the view ${sysId} is not in the mirror: pull, or use the Default view`;
}

// The lists whose record or columns file changed since the pull, each planned whole.
export async function planLists(
  workspace: DeliveryWorkspace,
  files: readonly string[],
  commit: string,
): Promise<{ readonly lists: PlannedList[]; readonly problems: PlanProblem[] }> {
  const lists: PlannedList[] = [];
  const problems: PlanProblem[] = [];
  for (const base of [...new Set(files.filter(isListFile).map(listBase))].sort()) {
    const path = `${base}.yaml`;
    try {
      const pulled = await pulledBase(workspace, base, commit);
      const before = pulled === null ? null : await filesAt(workspace, pulled, commit);
      const after = await filesAt(workspace, base, null);
      const current = after ?? before;
      if (current === null) continue;
      const view = await viewOf(workspace, current, commit);
      if (typeof view === "string") {
        problems.push({ path, reason: view });
        continue;
      }
      const outcome = listChange(path, before, after, view);
      if (outcome.list !== null) lists.push(outcome.list);
      problems.push(...outcome.problems);
    } catch (error) {
      problems.push({ path, reason: `cannot read the list: ${String(error)}` });
    }
  }
  return { lists, problems };
}
