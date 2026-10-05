import type { Catalog } from "./catalog";

// Dictionary types whose values are written to their own file, with the file extension.
export const TEXT_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  script: "js",
  script_plain: "js",
  script_server: "js",
  script_client: "js",
  html: "html",
  html_script: "html",
  html_template: "html",
  translated_html: "html",
  css: "css",
  xml: "xml",
  json: "json",
};

// Well-known script fields, kept as files even when the dictionary cannot be read.
const KNOWN_FILE_FIELDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  sys_script_include: { script: "js" },
  sys_script: { script: "js" },
  sys_script_client: { script: "js" },
  catalog_script_client: { script: "js" },
  sys_ui_script: { script: "js" },
  sys_ui_action: { script: "js", client_script_v2: "js" },
  sys_ui_policy: { script_true: "js", script_false: "js" },
  sys_ui_page: { html: "html", client_script: "js", processing_script: "js" },
  sys_ui_macro: { xml: "xml" },
  sys_security_acl: { script: "js" },
  sys_ws_operation: { operation_script: "js" },
  sys_script_fix: { script: "js" },
  sysauto_script: { script: "js" },
  sysevent_script_action: { script: "js" },
  sys_transform_script: { script: "js" },
  sys_transform_map: { script: "js" },
  sys_processor: { script: "js" },
  sp_widget: { template: "html", css: "css", client_script: "js", script: "js", link: "js" },
  sp_angular_provider: { script: "js" },
};

export const SECRET_TYPES: ReadonlySet<string> = new Set([
  "password",
  "password2",
  "encrypted_text",
]);
const SECRET_FIELD_NAMES = [
  "api_key",
  "client_secret",
  "credential",
  "password",
  "password2",
  "private_key",
  "secret",
  "token",
  "access_token",
  "refresh_token",
];

// Credential and certificate classes, and noisy or derived ones: never synced.
const DENIED_CLASSES = new Set([
  "sys_documentation",
  "sys_translated_text",
  "sys_ui_message",
  "sys_ux_lib_asset",
  "sys_metadata_link",
  "sys_auth_profile_basic",
  "sys_auth_profile_oauth2",
  "oauth_entity",
  "oauth_entity_profile",
  "discovery_credentials",
  "sys_certificate",
  "sys_alias",
  "sys_connection",
  "sys_cred",
]);

export function isDeniedClass(table: string): boolean {
  return DENIED_CLASSES.has(table);
}

// Field -> extension for the fields of `table` written to their own file.
export function fileFields(catalog: Catalog, table: string): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const ancestor of catalog.ancestors(table).reverse()) {
    for (const [field, type] of Object.entries(catalog.declaredFields(ancestor))) {
      const extension = TEXT_TYPE_EXTENSIONS[type];
      if (extension !== undefined) {
        result.set(field, extension);
      }
    }
    for (const [field, extension] of Object.entries(KNOWN_FILE_FIELDS[ancestor] ?? {})) {
      result.set(field, extension);
    }
  }
  return result;
}

export function secretFields(catalog: Catalog, table: string): ReadonlySet<string> {
  const result = new Set(SECRET_FIELD_NAMES);
  for (const ancestor of catalog.ancestors(table)) {
    for (const [field, type] of Object.entries(catalog.declaredFields(ancestor))) {
      if (SECRET_TYPES.has(type)) {
        result.add(field);
      }
    }
  }
  return result;
}
