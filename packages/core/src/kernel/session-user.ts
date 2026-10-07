// ADR-0021: the user the instance signed the request in as. Checks query this instead of the
// username in instance.yaml, which anyone can edit and which an OAuth client does not choose.
// An instance that does not evaluate it matches nothing, so the checks fail closed.
export const SESSION_USER = "javascript:gs.getUserID()";
