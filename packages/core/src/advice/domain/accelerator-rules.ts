import type { Rule } from "./rule-types";

// The gate's check on accelerator packs (ADR-0026, item 2: enforcement, not guidance).
export const ACCELERATOR_RULES: readonly Rule[] = [
  {
    id: "SN-MNT-012",
    category: "manageability",
    severity: "block",
    title: "Activate a capability's plugins before pushing it",
    why: "Source an accelerator pack added belongs to a capability whose plugins are not active in the mirror's inventory: on the instance it would reference tables or behavior that do not exist yet.",
    remediation:
      "Run snagentic accelerator check with the pack and instance, activate the plugins it names, pull, then plan again.",
    scripts: [],
  },
];
