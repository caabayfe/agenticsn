import type { Rule } from "./rule-types";

// Checks on the ACL records themselves, which push writes through an elevated session
// (ADR-0024). They read record fields, not scripts.
const ACL: readonly string[] = ["sys_security_acl"];

export const ACL_RULES: readonly Rule[] = [
  {
    id: "SN-SEC-006",
    category: "security",
    severity: "block",
    title: "Write, create and delete ACLs must restrict access",
    why: "An active allow ACL with no role, condition, security attribute or script grants the operation to every user who reaches it.",
    remediation: "Add the role that should hold the operation, or a condition that limits it.",
    scripts: [],
    classes: ACL,
  },
  {
    id: "SN-SEC-007",
    category: "security",
    severity: "block",
    title: "Do not deactivate or delete deny ACLs",
    why: "A deny ACL overrides every allow ACL for its object; removing it opens the object to anyone an allow ACL admits.",
    remediation:
      "Keep the deny ACL active. If access must change, narrow it with a condition and record why.",
    scripts: [],
    classes: ACL,
  },
  {
    id: "SN-SEC-008",
    category: "security",
    severity: "warn",
    title: "Keep admin overrides on",
    why: "With admin overrides off, administrators stop passing the ACL by role, which can lock administrators and integrations out of records they must support.",
    remediation:
      "Turn admin overrides back on, or record why administrators must be held to this ACL.",
    scripts: [],
    classes: ACL,
  },
];
