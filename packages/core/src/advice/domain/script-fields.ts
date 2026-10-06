// Where a script runs: server-side, in a form (client), or in portal client code.
export type ScriptKind = "server" | "client" | "portal_client";

// The script fields of each class and where each runs. A field missing here is not checked:
// guessing a client script is server code would report rules that cannot apply.
export const SCRIPT_FIELDS: Readonly<Record<string, Readonly<Record<string, ScriptKind>>>> = {
  sys_script: { script: "server" },
  sys_script_include: { script: "server" },
  sys_security_acl: { script: "server" },
  sys_ws_operation: { operation_script: "server" },
  sysauto_script: { script: "server" },
  sysevent_script_action: { script: "server" },
  sys_script_fix: { script: "server" },
  sys_transform_map: { script: "server" },
  sys_transform_script: { script: "server" },
  sys_processor: { script: "server" },
  sys_script_client: { script: "client" },
  catalog_script_client: { script: "client" },
  sys_ui_policy: { script_true: "client", script_false: "client" },
  sys_ui_script: { script: "client" },
  sys_ui_action: { script: "server", client_script_v2: "client" },
  sys_ui_page: { client_script: "client", processing_script: "server" },
  sp_widget: { script: "server", client_script: "portal_client", link: "portal_client" },
  sp_angular_provider: { script: "portal_client" },
};

// A record's script fields and where each runs, given its field values (scripts included).
export function scriptFieldsOf(
  className: string,
  fields: Readonly<Record<string, string>>,
): Record<string, ScriptKind> {
  const known = { ...SCRIPT_FIELDS[className] };
  if (className === "sys_ui_action" && fields["client"] === "true") {
    // A client UI action runs its script in the browser, unless the script also carries
    // a server branch guarded by `typeof window` (the platform runs it on both sides).
    known["script"] = (fields["script"] ?? "").includes("typeof window") ? "server" : "client";
  }
  if (className === "sys_script" && fields["advanced"] === "false") {
    // A business rule without "advanced" ignores its script field.
    delete known["script"];
  }
  return known;
}

// Every kind a class's scripts may run as.
export function scriptKindsOf(className: string): ScriptKind[] {
  const kinds = new Set<ScriptKind>(Object.values(SCRIPT_FIELDS[className] ?? {}));
  if (className === "sys_ui_action") {
    kinds.add("client");
  }
  return [...kinds];
}
