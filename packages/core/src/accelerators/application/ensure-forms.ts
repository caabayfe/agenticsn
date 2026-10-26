import {
  type FormFieldFact,
  formFieldId,
  formFieldStatus,
  placedElements,
  type SectionState,
  sectionSource,
} from "../domain/ensure-form";
import type { Adoption } from "../domain/materialize";
import type { InstallSteps } from "../ports";

// form_field facts at install time (ADR-0042): each section read live when its module is
// delivered, restated whole as the instance holds it with the modules' missing fields, in the
// project of the scope that owns it, committed, and taken over (restated: a client's
// customization stays in it, D1). A fact whose field is already on the form, or whose section
// the instance lacks, changes nothing.
export async function ensureForms(
  deps: { readonly steps: Pick<InstallSteps, "sections" | "project" | "writeFile" | "commit"> },
  pack: string,
  facts: readonly FormFieldFact[],
  signal: AbortSignal,
): Promise<{ readonly adoptions: Adoption[]; readonly written: readonly string[] }> {
  if (facts.length === 0) return { adoptions: [], written: [] };
  const states = await deps.steps.sections(facts, signal);
  const bySection = new Map<string, { state: SectionState; facts: FormFieldFact[] }>();
  facts.forEach((fact, i) => {
    const state = states[i];
    if (state?.sysId === null || state === undefined) return;
    const status = formFieldStatus(fact, state, formFieldId(pack, fact));
    // A section is restated while it holds or lacks one of ours: a stale file never stays behind.
    if (status !== "missing" && status !== "ours") return;
    const group = bySection.get(state.sysId) ?? { state, facts: [] };
    group.facts.push(fact);
    bySection.set(state.sysId, group);
  });
  const written: string[] = [];
  const adoptions: Adoption[] = [];
  for (const [sysId, { state, facts: own }] of bySection) {
    const project = await deps.steps.project(state.scope);
    written.push(...project.written);
    const path = `${project.path}/src/fluent/ensure-section-${sysId}.now.ts`;
    const { elements } = placedElements(pack, state, own);
    await deps.steps.writeFile(path, sectionSource({ ...state, sysId }, elements));
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
  if (written.length > 0) {
    await deps.steps.commit(written, "chore(snagentic): the form sections the accelerator adds to");
  }
  return { adoptions, written };
}
