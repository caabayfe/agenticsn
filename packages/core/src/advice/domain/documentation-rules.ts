import type { Rule } from "./rule-types";

// Checks of the workspace's documentation (ADR-0035, spec 010 P4): pages cite mirror records as
// evidence, so a change to one of those records, or a mirror that moved on, makes the page
// worth a look. Warnings: the change may be right and the page wrong, and `docs check` is the
// strict gate.
export const DOCUMENTATION_RULES: readonly Rule[] = [
  {
    id: "SN-MNT-014",
    category: "manageability",
    severity: "warn",
    title: "The change edits a documented record",
    why: "A documentation page cites this record as evidence for what users, operators or the platform team are told. Changing the record can make the page wrong without anyone noticing.",
    remediation:
      "Update the cited sections of the page in the same change. After the change is pushed and pulled, re-read the record and run snagentic docs pin <page>.",
    scripts: [],
  },
  {
    id: "SN-MNT-015",
    category: "manageability",
    severity: "warn",
    title: "Documentation no longer matches the instance",
    why: "The record a page cites changed in the mirror, or is gone, since the page was last verified: the instance moved on and the page may now tell people something untrue.",
    remediation:
      "Re-read the record, correct the page, then run snagentic docs pin <page>; snagentic docs check lists every such page.",
    scripts: [],
  },
];
