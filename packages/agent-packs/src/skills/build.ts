import type { Skill } from "../skill";

export const BUILD: Skill = {
  name: "servicenow-build",
  description:
    "Build an approved ServiceNow design as Fluent source in the workspace: adopt the records to change, write new ones, then validate until clean. Use after servicenow-design, or when the user asks to implement a change they already agreed.",
  when: "A design the user approved. Without one, use servicenow-design first.",
  steps: [
    "`advise` with the same `intent` and `tables`, and `phase` build: follow its `guidance` and `rules` for the classes you touch.",
    "For each record the instance already holds and the design changes, `describe` it (`target`: its mirror path), then `adopt` it with that path and the development `instance`. Edit the files adopt lists under source/<scope>/: the .now.ts definition, and the script in its Now.include file.",
    "For a new record, write a Fluent definition in its scope's project, in src/fluent/<feature>.now.ts: the typed APIs from @servicenow/sdk/core (Table, BusinessRule, ScriptInclude, ClientScript, UiAction, UiPolicy, Acl, Role, List, Form, ...) or Record({ table, data }) for any other table, following the ServiceNow SDK's Fluent documentation. Give every $id a stable Now.ID['<name>'], and keep scripts in Now.include('./<name>.server.js') files. A scope with no project yet gets one when you adopt any of its records.",
    'A new application (when the design asks for a new scope): in source/global, a Record({ table: \'sys_app\', data: { name, scope, version: \'1.0.0\' } }); the scope is x_ then the instance\'s company code (the property glide.appcreator.company.code in the mirror) then _ and a short name. Push it first. Then make the application\'s project: source/<scope>/now.config.json with { "scope": "<scope>", "scopeId": "<the sys_app\'s sys_id, from source/global/src/fluent/generated/keys.ts>", "type": "configuration" } and a package.json naming @servicenow/sdk as source/global\'s does; write the application\'s records there.',
    "A flow, subflow or custom action: Flow, Subflow and Action from @servicenow/sdk/automation, in the scope's project. Push loads and publishes it into the batch.",
    "On a domain-separated instance (status lists its domains), an application's logic belongs in global; a customer's own change sets $override: { sys_domain: '<domain sys_id>' } on the definition.",
    "To delete a record, add Now.del('<table>', { <keys> }) in source; removing a definition deletes nothing on the instance.",
    "`validate` (no arguments: everything changed since the last commit). It builds each project the change touched.",
    "Fix every finding whose `severity` is block, and each warn unless the user accepts it. Repeat `validate` until it has `passed`.",
  ],
  decide: [
    "`adopt` refuses with differences it cannot explain, or rows in a domain the SDK would not keep: tell the user which records and why; adopt the others without them.",
    "`adopt` lists records it leaves `unmanaged` (the SDK cannot express them): they stay as they are on the instance; say so.",
    "`validate` reports SN-MNT-010 (new IDs not in keys.ts): commit through the pre-commit hook, which writes and stages src/fluent/generated/keys.ts.",
    "A script in a scoped application reads or writes a global table or API: add a CrossScopePrivilege for it in the application's project, since runtime access tracking grants it only in interactive sessions and background scripts then fail silently.",
    "A scoped script must change a platform table the platform protects from scopes (role assignments, group memberships): put the change in a narrow global script include that checks its caller's record, and call that.",
    "An operation the platform can refuse (a delete, a cross-scope write): check its result, and never record it as done when it was refused.",
    "A finding is on a line you did not mean to change: `validate` reports only what the change introduced, so check your edit.",
    "`notChecked` is not empty: tell the user which files were not checked and why.",
    "A fix would change the approved design: stop and go back to the user.",
  ],
  output:
    "The source files changed (paths), the records adopted, the final `counts` from `validate`, and any warn the user accepted, with its `ruleId`.",
  stopAndAsk:
    "When a fix would change the approved design, when adopt refuses a record, or when a finding looks wrong (say which `ruleId` and why).",
  never: [
    "Never silence or work around a finding to make `validate` pass.",
    "Never edit the mirror (instances/*/metadata) or a snagentic.ledger.yaml; never write a record's XML or call the instance yourself.",
    "Never change a record the instance holds without adopting it first: plan refuses it, and the instance's copy would be overwritten.",
  ],
};
