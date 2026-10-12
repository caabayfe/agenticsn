// ACL record checks (ADR-0024: push can now write ACLs, so the gate must read them).

// An ACL's fields, and how many role records point at it: null when other fields already
// restrict it, so the roles were not counted.
export interface AclState {
  readonly fields: Readonly<Record<string, string>>;
  readonly roles: number | null;
}

export interface AclHit {
  readonly ruleId: string;
  readonly field: string | null;
  readonly message: string;
}

const WRITES = new Set(["write", "create", "delete"]);

const blank = (value: string | undefined) => (value ?? "").trim() === "";
// The platform's default for a new ACL is active.
const active = (fields: AclState["fields"]) => fields["active"] !== "false";
const deny = (fields: AclState["fields"]) => fields["decision_type"] === "deny";
const nameOf = (fields: AclState["fields"]) =>
  `${fields["operation"] ?? ""} ACL ${fields["name"] ?? ""}`.trim();

// Whether nothing but roles could restrict this ACL. A script restricts only when advanced.
export function opensWithoutRoles(fields: AclState["fields"]): boolean {
  const scripted = fields["advanced"] === "true" && !blank(fields["script"]);
  return (
    active(fields) &&
    !deny(fields) &&
    WRITES.has(fields["operation"] ?? "") &&
    blank(fields["condition"]) &&
    blank(fields["security_attribute"]) &&
    !scripted
  );
}

const unrestricted = (acl: AclState | null) =>
  acl !== null && acl.roles === 0 && opensWithoutRoles(acl.fields);

// How the change takes an active deny ACL away, if it does.
function denyRemoved(before: AclState | null, now: AclState | null): string | null {
  if (before === null || !deny(before.fields) || !active(before.fields)) {
    return null;
  }
  const acl = `the deny ${nameOf(before.fields)}`;
  if (now === null) {
    return `the change deletes ${acl}`;
  }
  if (!active(now.fields)) {
    return `the change deactivates ${acl}`;
  }
  return deny(now.fields) ? null : `the change turns ${acl} into an allow ACL`;
}

// What the change from `before` to `now` introduces; null means the record does not exist.
export function aclHits(before: AclState | null, now: AclState | null): AclHit[] {
  const hits: AclHit[] = [];
  if (now !== null && unrestricted(now) && !unrestricted(before)) {
    hits.push({
      ruleId: "SN-SEC-006",
      field: null,
      message: `the ${nameOf(now.fields)} has no role, condition or script, so it restricts nothing`,
    });
  }
  const removed = denyRemoved(before, now);
  if (removed !== null) {
    hits.push({ ruleId: "SN-SEC-007", field: now === null ? null : "active", message: removed });
  }
  if (before?.fields["admin_overrides"] === "true" && now?.fields["admin_overrides"] === "false") {
    hits.push({
      ruleId: "SN-SEC-008",
      field: "admin_overrides",
      message: `the change turns admin overrides off on the ${nameOf(now.fields)}`,
    });
  }
  return hits;
}
