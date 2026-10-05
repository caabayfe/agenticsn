import { describe, expect, it } from "bun:test";
import {
  Catalog,
  DEFAULT_REDACTION,
  fieldsToRedact,
  fileFields,
  isDeniedClass,
  secretFields,
} from "@snagentic/core";

const catalog = new Catalog({
  parents: {
    sys_metadata: null,
    sys_script: "sys_metadata",
    sys_script_include: "sys_metadata",
    sys_properties: "sys_metadata",
    x_custom_rule: "sys_script",
    incident: "task",
    task: null,
    loop_a: "loop_b",
    loop_b: "loop_a",
  },
  scopes: { aa11: "x_acme_app", global: "global" },
  typedFields: {
    sys_metadata: { sys_name: "string" },
    sys_script: { script: "script_server", condition: "condition_string", description: "string" },
    x_custom_rule: { u_template: "html", u_api_secret: "password2" },
  },
});

describe("Catalog", () => {
  it("lists a class and its ancestors, nearest first", () => {
    expect(catalog.ancestors("x_custom_rule")).toEqual([
      "x_custom_rule",
      "sys_script",
      "sys_metadata",
    ]);
  });

  it("stops on a cycle in a corrupt hierarchy instead of looping", () => {
    expect(catalog.ancestors("loop_a")).toEqual(["loop_a", "loop_b"]);
  });

  it("knows which classes are metadata", () => {
    expect([catalog.isMetadata("x_custom_rule"), catalog.isMetadata("incident")]).toEqual([
      true,
      false,
    ]);
    expect(catalog.metadataClasses()).toEqual([
      "sys_metadata",
      "sys_properties",
      "sys_script",
      "sys_script_include",
      "x_custom_rule",
    ]);
  });

  it("maps a scope sys_id to its namespace, and an empty or unknown scope to global or itself", () => {
    expect(
      [
        catalog.scopeNamespace("aa11"),
        catalog.scopeNamespace(""),
        catalog.scopeNamespace(null),
      ].map(String),
    ).toEqual(["x_acme_app", "global", "global"]);
  });
});

describe("field rules", () => {
  it("writes script, HTML, CSS, XML and JSON fields to their own files, inherited ones included", () => {
    expect(Object.fromEntries(fileFields(catalog, "x_custom_rule"))).toEqual({
      script: "js",
      u_template: "html",
    });
  });

  it("keeps well-known script fields as files even without dictionary data", () => {
    expect(Object.fromEntries(fileFields(catalog, "sys_script_include"))).toEqual({ script: "js" });
  });

  it("treats password and encrypted fields and well-known secret names as secrets", () => {
    const secrets = secretFields(catalog, "x_custom_rule");
    expect(secrets.has("u_api_secret")).toBe(true);
    expect(secrets.has("client_secret")).toBe(true);
    expect(secrets.has("script")).toBe(false);
  });

  it.each(["sys_cred", "oauth_entity", "sys_certificate", "discovery_credentials"])(
    "never syncs the credential class %p",
    (table) => {
      expect(isDeniedClass(table)).toBe(true);
    },
  );
});

describe("fieldsToRedact", () => {
  it("redacts property values unless the property is allowlisted", () => {
    expect(
      fieldsToRedact(catalog, "sys_properties", "glide.ui.title", DEFAULT_REDACTION).has("value"),
    ).toBe(true);
    const policy = { ...DEFAULT_REDACTION, propertyValueAllowlist: ["glide.ui.title"] };
    expect(fieldsToRedact(catalog, "sys_properties", "glide.ui.title", policy).has("value")).toBe(
      false,
    );
  });

  it("keeps secret-looking property values redacted even when allowlisted", () => {
    const policy = {
      ...DEFAULT_REDACTION,
      propertyValueAllowlist: ["acme.api_key", "acme.client.secret"],
    };
    expect(fieldsToRedact(catalog, "sys_properties", "acme.api_key", policy).has("value")).toBe(
      true,
    );
    expect(
      fieldsToRedact(catalog, "sys_properties", "acme.client.secret", policy).has("value"),
    ).toBe(true);
  });
});
