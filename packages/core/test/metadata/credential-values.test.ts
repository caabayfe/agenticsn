import { describe, expect, it } from "bun:test";
import {
  artifactFromRow,
  Catalog,
  DEFAULT_REDACTION,
  fieldsToRedact,
  renderRecord,
  withoutCredentialValue,
} from "@snagentic/core";

// Spec 014, SEC2-02: a header or parameter row keeps its name and value in separate fields, so
// the value scan alone can't tell a credential. Values here are placeholders, not credentials.
const catalog = new Catalog({
  parents: {
    sys_metadata: null,
    sys_rest_message_headers: "sys_metadata",
    sys_rest_message_fn_headers: "sys_metadata",
    sys_rest_message_fn_parameters: "sys_metadata",
    sys_soap_message_parameters: "sys_metadata",
    x_acme_rest_header: "sys_rest_message_fn_headers",
    sys_script: "sys_metadata",
  },
  scopes: {},
  typedFields: {},
});

const VALUE = "placeholder-not-a-credential";

const header = (table: string, name: string, value: string) => ({
  sys_id: "0123456789abcdef0123456789abcdef",
  sys_class_name: table,
  sys_scope: "global",
  sys_updated_on: "2026-11-10 10:00:00",
  name,
  value,
  rest_message: "fedcba9876543210fedcba9876543210",
});

const redacts = (table: string, name: string, value = VALUE) =>
  fieldsToRedact(catalog, table, header(table, name, value), DEFAULT_REDACTION).has("value");

describe("credential header and parameter values", () => {
  it("redacts the value of a header or parameter whose name marks a credential", () => {
    for (const [table, name] of [
      ["sys_rest_message_headers", "Authorization"],
      ["sys_rest_message_fn_headers", "Proxy-Authorization"],
      ["sys_rest_message_fn_headers", "x-api-key"],
      ["sys_rest_message_fn_parameters", "access_token"],
      ["sys_soap_message_parameters", "access_key"],
      ["sys_soap_message_parameters", "Password"],
      ["sys_rest_message_headers", "Ocp-Apim-Subscription-Key"],
      // A class that extends a header table holds what its parent holds.
      ["x_acme_rest_header", "Authorization"],
    ] as const) {
      expect([table, name, redacts(table, name)]).toEqual([table, name, true]);
    }
  });

  it("keeps ordinary headers, empty values and values that only name a variable", () => {
    expect(redacts("sys_rest_message_headers", "Content-Type", "application/json")).toBe(false);
    expect(redacts("sys_rest_message_fn_parameters", "sysparm_limit", "10")).toBe(false);
    expect(redacts("sys_rest_message_headers", "Authorization", "")).toBe(false);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a ServiceNow variable substitution
    expect(redacts("sys_rest_message_headers", "Authorization", "Bearer ${token}")).toBe(false);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a ServiceNow variable substitution
    expect(redacts("sys_rest_message_fn_headers", "x-api-key", "${api_key}")).toBe(false);
    // The name rule belongs to header and parameter tables only.
    expect(redacts("sys_script", "Authorization")).toBe(false);
  });

  it("leaves the value out of what a pull writes, and names it as redacted", () => {
    const artifact = artifactFromRow(
      header("sys_rest_message_headers", "Authorization", `Basic ${VALUE}`),
      catalog,
      DEFAULT_REDACTION,
    );
    const rendered = renderRecord(artifact, catalog);
    expect(JSON.stringify(rendered)).not.toContain(VALUE);
    expect(rendered.document["_meta"]).toMatchObject({ redacted: ["value"] });
    expect(rendered.document["name"]).toBe("Authorization");
  });

  it("rewrites a committed record file as a pull now writes it", () => {
    const row = header("sys_rest_message_fn_headers", "Authorization", `Bearer ${VALUE}`);
    const before = renderRecord(
      artifactFromRow({ ...row, name: "X-Placeholder" }, catalog, DEFAULT_REDACTION),
      catalog,
    ).document;
    const committed = { ...before, name: "Authorization" };
    const now = renderRecord(artifactFromRow(row, catalog, DEFAULT_REDACTION), catalog).document;
    const rewritten = withoutCredentialValue(committed, catalog);
    expect(rewritten).toEqual(now);
    expect(JSON.stringify(rewritten)).not.toContain(VALUE);
  });

  it("leaves other committed files alone", () => {
    const ordinary = renderRecord(
      artifactFromRow(
        header("sys_rest_message_headers", "Accept", "text/xml"),
        catalog,
        DEFAULT_REDACTION,
      ),
      catalog,
    ).document;
    expect(withoutCredentialValue(ordinary, catalog)).toBeNull();
    expect(withoutCredentialValue({ name: "Authorization", value: VALUE }, catalog)).toBeNull();
    expect(withoutCredentialValue("text", catalog)).toBeNull();
  });
});
