import type { Rule } from "./rule-types";

// Checks of the workspace's documentation (ADR-0036, spec 010 P4): pages cite mirror records as
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
      "Update the cited sections of the page in the same change: snagentic docs impact lists each claim the change affects. After the change is pushed and pulled, re-read the record and run snagentic docs pin <page>.",
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
  {
    id: "SN-MNT-016",
    category: "manageability",
    severity: "warn",
    title: "A documented capability has no animation",
    why: "Every user and operator guide shows its capability as a narrated animation (spec 010c): people follow a process far better when they see it move than when they read it.",
    remediation:
      "Add an animation under documentation/animations/<name>/ and embed it on the page with {{animation:<name>}}; snagentic docs check lists every page without one.",
    scripts: [],
  },
  {
    id: "SN-MNT-017",
    category: "manageability",
    severity: "warn",
    title: "A page changed what readers are told, without a release note",
    why: "The page was pinned again because a record it cites changed, so it may now tell employees or IT something new. Readers learn what changed from the release notes on the What's new pages (ADR-0039), and this change adds none for the page.",
    remediation:
      "Add a note to the release file (documentation/changes/<release>.md) for employees or it, saying what changed in the readers' words, with a see: reference to the page.",
    scripts: [],
  },
];
