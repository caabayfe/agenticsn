import {
  type FormFieldFact,
  formFieldId,
  formFieldStatus,
  placedElements,
  type SectionState,
  sectionSource,
} from "../domain/ensure-form";
import {
  droppedElements,
  type FormSectionRecord,
  formRecordOf,
  formRecordText,
  probeOf,
} from "../domain/ensure-form-record";
import type { Adoption } from "../domain/materialize";
import type { InstallSteps } from "../ports";

// form_field facts at install time (ADR-0042): each section read live when its module is
// delivered, restated whole as the instance holds it with the modules' missing fields, in the
// project of the scope that owns it, committed, and taken over (restated: a client's
// customization stays in it, D1). A fact whose field is already on the form, or whose section
// the instance lacks, changes nothing. A fact the module dropped takes its own element off the
// section (removal, form-field-plan.md section 4 item 6): the record names the sections each
// module added to.

type FormSteps = Pick<InstallSteps, "sections" | "project" | "writeFile" | "readFile" | "commit">;

// The modules this delivery covers, and the workspace path of the pack's record of sections.
export interface FormDelivery {
  readonly modules: readonly string[];
  readonly record: string;
}

interface Group {
  readonly state: SectionState & { readonly sysId: string };
  readonly facts: FormFieldFact[];
  readonly dropped: Set<string>;
}

const viewKey = (table: string, view: string) => `${table}\u0000${view}`;

// A section as the facts see it: the fields leaving its view no longer count as on the form.
const without = <S extends SectionState>(
  state: S,
  leaving: ReadonlyMap<string, ReadonlySet<string>>,
): S => {
  const gone = leaving.get(viewKey(state.table, state.view)) ?? new Set<string>();
  return { ...state, onView: state.onView.filter((f) => !gone.has(f)) };
};

function groupOf(groups: Map<string, Group>, state: SectionState & { readonly sysId: string }) {
  const group = groups.get(state.sysId) ?? { state, facts: [], dropped: new Set<string>() };
  groups.set(state.sysId, group);
  return group;
}

// The elements the delivered modules dropped, by section, and their fields by form view: a field
// moved to another section is added there although the view still shows it where it was.
function dropsOf(
  pack: string,
  facts: readonly FormFieldFact[],
  probes: readonly { record: FormSectionRecord; state: SectionState | undefined }[],
  groups: Map<string, Group>,
) {
  const leaving = new Map<string, Set<string>>();
  for (const { record, state } of probes) {
    if (state?.sysId === null || state === undefined) continue;
    const own = facts.filter((f) => f.capability === record.module);
    const dropped = droppedElements(pack, record, state, own);
    if (dropped.length === 0) continue;
    const group = groupOf(groups, { ...state, sysId: state.sysId });
    const fields = leaving.get(viewKey(record.table, record.view)) ?? new Set<string>();
    for (const element of state.elements.filter((e) => dropped.includes(e.sysId))) {
      group.dropped.add(element.sysId);
      fields.add(element.element);
    }
    leaving.set(viewKey(record.table, record.view), fields);
  }
  return leaving;
}

// The facts to restate, by section, and the record entries they keep.
function addsOf(
  pack: string,
  facts: readonly FormFieldFact[],
  states: readonly (SectionState | undefined)[],
  leaving: ReadonlyMap<string, ReadonlySet<string>>,
  groups: Map<string, Group>,
): FormSectionRecord[] {
  const kept: FormSectionRecord[] = [];
  facts.forEach((fact, i) => {
    const read = states[i];
    if (read?.sysId === null || read === undefined) return;
    const state = without({ ...read, sysId: read.sysId }, leaving);
    const status = formFieldStatus(fact, state, formFieldId(pack, fact));
    // A section is restated while it holds or lacks one of ours: a stale file never stays behind.
    if (status !== "missing" && status !== "ours") return;
    groupOf(groups, state).facts.push(fact);
    kept.push({
      module: fact.capability,
      sysId: state.sysId,
      table: fact.table,
      view: fact.view,
      caption: fact.section,
    });
  });
  return kept;
}

export async function ensureForms(
  deps: { readonly steps: FormSteps },
  pack: string,
  facts: readonly FormFieldFact[],
  delivery: FormDelivery,
  signal: AbortSignal,
): Promise<{ readonly adoptions: Adoption[]; readonly written: readonly string[] }> {
  const recordText = await deps.steps.readFile(delivery.record);
  const recorded = formRecordOf(recordText);
  const ours = (r: FormSectionRecord) => delivery.modules.includes(r.module);
  const probes = recorded.filter(ours);
  if (facts.length === 0 && probes.length === 0) return { adoptions: [], written: [] };
  const states = await deps.steps.sections([...facts, ...probes.map(probeOf)], signal);
  const groups = new Map<string, Group>();
  const probed = probes.map((record, i) => ({ record, state: states[facts.length + i] }));
  const leaving = dropsOf(pack, facts, probed, groups);
  const kept = addsOf(pack, facts, states, leaving, groups);
  const { adoptions, written } = await restate(deps, pack, groups, leaving);
  // The record is committed with the sections, but is no Fluent source: it gets no keys.
  const text = formRecordText([...recorded.filter((r) => !ours(r)), ...kept]);
  const record = text === (recordText ?? formRecordText([])) ? [] : [delivery.record];
  if (record.length > 0) await deps.steps.writeFile(delivery.record, text);
  if (written.length + record.length > 0) {
    await deps.steps.commit(
      [...written, ...record],
      "chore(snagentic): the form sections the accelerator adds to",
    );
  }
  return { adoptions, written };
}

// Each section written whole in its scope's project, and taken over as restated.
async function restate(
  deps: { readonly steps: FormSteps },
  pack: string,
  groups: ReadonlyMap<string, Group>,
  leaving: ReadonlyMap<string, ReadonlySet<string>>,
) {
  const written: string[] = [];
  const adoptions: Adoption[] = [];
  for (const [sysId, { state, facts, dropped }] of groups) {
    const project = await deps.steps.project(state.scope);
    written.push(...project.written);
    const path = `${project.path}/src/fluent/ensure-section-${sysId}.now.ts`;
    const { elements } = placedElements(pack, without(state, leaving), facts, dropped);
    await deps.steps.writeFile(path, sectionSource(state, elements));
    written.push(path);
    adoptions.push({
      capability: "ensure",
      table: "sys_ui_section",
      sysId,
      note: `form section "${state.caption}" of ${state.table}, ${state.view}`,
      whenAbsent: "stop",
      restated: true,
    });
  }
  return { adoptions, written };
}
