import {
  type EnsureFact,
  ensureEntryId,
  factStatus,
  isFormFieldFact,
  isListFact,
  type ListFact,
} from "../domain/ensure";
import { type FormFieldFact, formFieldId, formFieldStatus } from "../domain/ensure-form";
import type { InstallSteps } from "../ports";

// The install's last check (ADR-0042, section 4): every fact of the plan's modules read again
// after the install, live like at delivery, since the mirror only shows what the last pull
// caught. A fact that no longer holds (a plugin activated since replaced the layout) is
// reported, and the next install adds it again; a fact whose layout or section the instance
// lacks was skipped, and is named as such.

export interface EnsuredCheck {
  readonly held: number;
  readonly lost: readonly string[];
  readonly skipped: readonly string[];
}

const listWhere = (f: ListFact) => `${f.table} ${f.view}: related list ${f.list} (${f.capability})`;
const fieldWhere = (f: FormFieldFact) =>
  `${f.table} ${f.view}${f.section === "" ? "" : ` "${f.section}"`}: field ${f.field} (${f.capability})`;

export async function checkEnsured(
  deps: { readonly steps: Pick<InstallSteps, "layouts" | "sections"> },
  pack: string,
  facts: readonly EnsureFact[],
  signal: AbortSignal,
): Promise<EnsuredCheck> {
  const lists = facts.filter(isListFact);
  const fields = facts.filter(isFormFieldFact);
  const layouts = lists.length === 0 ? [] : await deps.steps.layouts(lists, signal);
  const sections = fields.length === 0 ? [] : await deps.steps.sections(fields, signal);
  const statuses = [
    ...lists.map((fact, i) => {
      const state = layouts[i];
      const status =
        state === undefined ? "absent" : factStatus(fact, state, ensureEntryId(pack, fact));
      return { status, where: listWhere(fact) };
    }),
    ...fields.map((fact, i) => {
      const state = sections[i];
      const status =
        state === undefined ? "absent" : formFieldStatus(fact, state, formFieldId(pack, fact));
      return { status, where: fieldWhere(fact) };
    }),
  ];
  return {
    held: statuses.filter((s) => s.status === "ours" || s.status === "present").length,
    lost: statuses.filter((s) => s.status === "missing").map((s) => s.where),
    skipped: statuses.filter((s) => s.status === "absent").map((s) => s.where),
  };
}

// The check as the install report says it.
export function ensuredDetail(check: EnsuredCheck): string {
  const total = check.held + check.lost.length + check.skipped.length;
  const parts = [`${check.held} of ${total} hold`];
  if (check.lost.length > 0) {
    parts.push(
      `no longer on the instance: ${check.lost.join("; ")} (install again to add them back)`,
    );
  }
  if (check.skipped.length > 0) {
    parts.push(`skipped, not on this instance: ${check.skipped.join("; ")}`);
  }
  return parts.join("; ");
}
