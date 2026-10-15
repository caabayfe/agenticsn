import type { Rule } from "./rule-types";

// Checks on Fluent projects (`source/<scope>/`), which snagentic builds with the embedded
// ServiceNow SDK and delivers by push (ADR-0028 as amended). They read the build, not scripts.
const FLOWS: readonly string[] = ["sys_hub_flow", "sys_hub_action_type_definition"];

export const FLUENT_RULES: readonly Rule[] = [
  {
    id: "SN-MNT-009",
    category: "manageability",
    severity: "block",
    title: "Fluent source must build",
    why: "A Fluent project that does not build cannot be delivered: push builds every changed project and installs what the build produced.",
    remediation:
      "Fix the error at the reported line; the code is the SDK's (ts for TypeScript, fluent for Fluent).",
    scripts: [],
    classes: FLOWS,
  },
  {
    id: "SN-MNT-010",
    category: "manageability",
    severity: "block",
    title: "Commit the generated keys of a Fluent project",
    why: "The first build of a new Now.ID picks a random sys_id and writes it to src/fluent/generated/keys.ts. Until that file is committed, every build names the records differently and plan and push disagree.",
    remediation:
      "Commit through the pre-commit hook, which writes and stages keys.ts, or run snagentic fluent-keys with the project folder and commit src/fluent/generated/keys.ts with the source that added the new IDs.",
    scripts: [],
    classes: FLOWS,
  },
  {
    id: "SN-MNT-011",
    category: "manageability",
    severity: "block",
    title: "A Fluent build must not delete records",
    why: "The SDK deletes the records of keys a project no longer uses. Removing a flow from source would delete it from the instance, and keys the project never owned (such as the SDK's built-in actions) would delete platform records.",
    remediation:
      "Restore the removed source and deactivate it instead; remove keys from keys.ts only for records this project created.",
    scripts: [],
    classes: FLOWS,
  },
  {
    id: "SN-UPG-003",
    category: "upgradability",
    severity: "warn",
    title: "Build Fluent projects with the SDK snagentic ships",
    why: "snagentic builds every Fluent project with the ServiceNow SDK version it was released with; a project written for another version may use APIs that version does not have, or build differently.",
    remediation:
      "Set @servicenow/sdk in the project's package.json to the version validate reports, or upgrade snagentic.",
    scripts: [],
    classes: FLOWS,
  },
];
