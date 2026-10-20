import { coverage, type FeatureStatus, featureCapability, type ProcessFeatures } from "./features";
import { escapeHtml } from "./html";
import type { Process } from "./process";
import { type Built, link } from "./site-context";
import { pageFile, prefixOf } from "./site-layout";

// The features of a process on its IT page (ADR-0040): each with its decision and the pages that
// document it, so a reader sees what is covered and what was left out, and why.

const STATUS: Readonly<Record<FeatureStatus, { readonly text: string; readonly label: string }>> = {
  documented: { text: "Documented", label: "new" },
  todo: { text: "To do", label: "corrected" },
  question: { text: "Question", label: "open-question" },
  "out-of-scope": { text: "Out of scope", label: "changed" },
};

export const featuresOf = (b: Built, process: Process): ProcessFeatures | undefined =>
  b.input.features?.find((item) => item.process === process.id);

// "4 of 12 features documented", or nothing for a process without features.yaml.
export function coverageText(b: Built, process: Process): string | null {
  const declared = featuresOf(b, process);
  if (declared === undefined) return null;
  const { documented, total } = coverage(declared);
  return `${documented} of ${total} features documented`;
}

function pagesOf(b: Built, process: Process, refs: readonly string[], file: string): string {
  return refs
    .flatMap((ref) => {
      const found = featureCapability(ref, process.id, b.input.processes);
      if (found === null) return [];
      const page =
        b.page(found.process.id, "operate", found.capability.id) ??
        b.page(found.process.id, "use", found.capability.id);
      return page === undefined ? [] : [link(prefixOf(file), pageFile(page), page.title)];
    })
    .join(", ");
}

export function featuresHtml(b: Built, process: Process, file: string): string {
  const declared = featuresOf(b, process);
  if (declared === undefined || declared.features.length === 0) return "";
  const rows = declared.features.map((feature) => {
    const status = STATUS[feature.status];
    const pages = pagesOf(b, process, feature.capabilities, file);
    const note = feature.note === undefined ? "" : escapeHtml(feature.note);
    return `<tr><td>${escapeHtml(feature.title)}</td><td><span class="label label-${status.label}">${status.text}</span></td><td>${pages}${pages !== "" && note !== "" ? "<br>" : ""}${note}</td></tr>`;
  });
  return `<h2>Features</h2>
<p class="mute">${escapeHtml(coverageText(b, process) ?? "")}, from the census of what reaches the process on the instance and a walk of its screens.</p>
<table><thead><tr><th>Feature</th><th>Status</th><th>Pages, or why not</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}
