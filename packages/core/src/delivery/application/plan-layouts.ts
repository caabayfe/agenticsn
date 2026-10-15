import { recordAddress } from "../../metadata/domain/record-layout";
import type { PlanProblem } from "../domain/change";
import {
  type LayoutFiles,
  layoutChange,
  type PlannedLayout,
  type SectionRef,
} from "../domain/layout-changes";
import { type LayoutKindSpec, layoutKindOf } from "../domain/layout-kinds";
import { DEFAULT_VIEW, type LayoutView } from "../domain/layout-xml";
import type { DeliveryWorkspace } from "../ports";
import { parsed, pulledBase } from "./plan-records";

// <scope>/<class>/<name>--<sys_id>.yaml, or its rows file, for a class delivered whole.
const LAYOUT_FILE =
  /(?:^|\/)(sys_ui_list|sys_ui_section|sys_ui_form|sys_ui_related_list)\/[^/]+\.yaml$/;
const VIEWS = "global/sys_ui_view";

const specOf = (path: string) => layoutKindOf(LAYOUT_FILE.exec(path)?.[1] ?? "");

// A layout's record file or its rows file: planned as one layout (ADR-0029, ADR-0030), never as
// records or rows.
export const isLayoutFile = (path: string) => specOf(path) !== undefined;

const rowsFile = (spec: LayoutKindSpec, base: string) => `${base}.children.${spec.rows}.yaml`;

const baseOf = (spec: LayoutKindSpec, path: string) => {
  const suffix = `.children.${spec.rows}.yaml`;
  return path.endsWith(suffix) ? path.slice(0, -suffix.length) : path.replace(/\.yaml$/, "");
};

async function filesAt(
  workspace: DeliveryWorkspace,
  spec: LayoutKindSpec,
  base: string,
  at: string | null,
): Promise<LayoutFiles | null> {
  const record = await parsed(workspace, base, at);
  return record === null
    ? null
    : { record, rows: await workspace.document(rowsFile(spec, base), at) };
}

// A record of `folder` (in any domain) by sys_id, in the mirror or, when this push creates it, in
// the working tree.
async function findRecord(
  workspace: DeliveryWorkspace,
  folder: string,
  sysId: string,
  commit: string,
) {
  for (const at of [null, commit]) {
    const base = (await workspace.recordsIn(folder, at)).find(
      (b) => recordAddress(b)?.sysId === sysId,
    );
    const record = base === undefined ? null : await parsed(workspace, base, at);
    if (record !== null) return record.artifact;
  }
  return null;
}

// The layout's view, as the update names it: the Default view by its sys_id, which is literally
// "Default view"; any other by its sys_id and its name.
async function viewOf(workspace: DeliveryWorkspace, sysId: string, commit: string) {
  if (sysId === DEFAULT_VIEW || sysId === "") {
    return { sysId: DEFAULT_VIEW, name: "" };
  }
  const view = await findRecord(workspace, VIEWS, sysId, commit);
  return view === null
    ? `the view ${sysId} is not in the mirror: pull, or use the Default view`
    : { sysId, name: view.fields["name"] ?? "" };
}

// The sections a form shows, as the platform matches them: caption, domain and view.
async function sectionsOf(workspace: DeliveryWorkspace, layout: PlannedLayout, commit: string) {
  const sections: Record<string, SectionRef> = {};
  const missing: string[] = [];
  for (const row of layout.rows) {
    const sysId = row["sys_ui_section"] ?? "";
    const section =
      (await findRecord(workspace, `${layout.scope}/sys_ui_section`, sysId, commit)) ??
      (await findRecord(workspace, "global/sys_ui_section", sysId, commit));
    if (section === null) {
      missing.push(`row ${row["sys_id"] ?? ""}: the section ${sysId} is not in the workspace`);
    } else {
      sections[sysId] = {
        caption: section.fields["caption"] ?? "",
        domain: section.identity.domain,
        viewSysId: section.fields["view"] || DEFAULT_VIEW,
      };
    }
  }
  return { sections, missing };
}

async function planOne(
  workspace: DeliveryWorkspace,
  spec: LayoutKindSpec,
  base: string,
  commit: string,
): Promise<{ layout: PlannedLayout | null; problems: PlanProblem[] }> {
  const path = `${base}.yaml`;
  const pulled = await pulledBase(workspace, base, commit);
  const before = pulled === null ? null : await filesAt(workspace, spec, pulled, commit);
  const after = await filesAt(workspace, spec, base, null);
  const current = after ?? before;
  if (current === null) return { layout: null, problems: [] };
  const view: LayoutView | string = await viewOf(
    workspace,
    current.record.artifact.fields["view"] ?? "",
    commit,
  );
  if (typeof view === "string") return { layout: null, problems: [{ path, reason: view }] };
  const outcome = layoutChange(spec, path, before, after, view);
  if (outcome.layout === null || spec.kind !== "form") {
    return { layout: outcome.layout, problems: [...outcome.problems] };
  }
  const { sections, missing } = await sectionsOf(workspace, outcome.layout, commit);
  return missing.length > 0
    ? { layout: null, problems: missing.map((reason) => ({ path, reason })) }
    : { layout: { ...outcome.layout, sections }, problems: [] };
}

// The layouts whose record or rows file changed since the pull, each planned whole.
export async function planLayouts(
  workspace: DeliveryWorkspace,
  files: readonly string[],
  commit: string,
): Promise<{ readonly layouts: PlannedLayout[]; readonly problems: PlanProblem[] }> {
  const layouts: PlannedLayout[] = [];
  const problems: PlanProblem[] = [];
  const bases = new Map<string, LayoutKindSpec>();
  for (const path of files) {
    const spec = specOf(path);
    if (spec !== undefined) bases.set(baseOf(spec, path), spec);
  }
  for (const [base, spec] of [...bases].sort(([a], [b]) => (a < b ? -1 : 1))) {
    try {
      const outcome = await planOne(workspace, spec, base, commit);
      if (outcome.layout !== null) layouts.push(outcome.layout);
      problems.push(...outcome.problems);
    } catch (error) {
      problems.push({
        path: `${base}.yaml`,
        reason: `cannot read the ${spec.noun}: ${String(error)}`,
      });
    }
  }
  return { layouts, problems };
}
