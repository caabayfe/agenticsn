import { InvalidScopeNameError } from "./adopt-errors";

// global, or a scope's namespace: lowercase letters, digits, underscores and hyphens (UI component
// scopes such as now-sla-timer). No dots or slashes, so it is always one plain folder name.
const SCOPE_NAME = /^[a-z][a-z0-9_-]{0,39}$/;

export function sourceScopeName(scope: string): string {
  if (!SCOPE_NAME.test(scope)) throw new InvalidScopeNameError(scope);
  return scope;
}
