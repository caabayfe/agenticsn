import type { BuiltUnit, UnitRecord } from "../../authoring/domain/unit";

// What a change to roles does to who holds the platform's most powerful roles. Pure.

export interface RoleHit {
  readonly ruleId: string;
  readonly field: string;
  readonly message: string;
}

// Roles that open the whole instance: whoever holds a role that contains one holds it too.
const PRIVILEGED: ReadonlySet<string> = new Set(["admin", "security_admin", "maint"]);

const CONTAINS = "sys_user_role_contains";

function hit(row: UnitRecord, holder: string): RoleHit[] {
  const contained = row.referenceNames["contains"] ?? "";
  if (row.action === "DELETE" || !PRIVILEGED.has(contained)) return [];
  const role = row.referenceNames["role"] ?? holder;
  return [
    {
      ruleId: "SN-SEC-009",
      field: "contains",
      message: `${role} contains ${contained}: everyone granted ${role} gets ${contained}`,
    },
  ];
}

// A containment of a privileged role, as a unit of its own or as a row of a role's unit.
export function roleHits(unit: BuiltUnit): RoleHit[] {
  const holder = unit.head.fields["name"] ?? "";
  const rows = [unit.head, ...unit.children].filter((row) => row.table === CONTAINS);
  return rows.flatMap((row) => hit(row, holder));
}
