import { describe, expect, it } from "bun:test";
import { Catalog, withheldReason } from "@snagentic/core";

const payload = (table: string, body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><record_update table="${table}"><${table} action="INSERT_OR_UPDATE">${body}</${table}></record_update>`;

// What the export reads about the tables in the set: their classes and password-typed fields.
const catalog = new Catalog({
  parents: {
    sys_metadata: null,
    sys_script: "sys_metadata",
    sys_script_include: "sys_metadata",
    sys_rest_message: "sys_metadata",
    sys_properties: "sys_metadata",
    sys_auth_profile_basic: "sys_metadata",
    discovery_credentials: null,
    ssh_credentials: "discovery_credentials",
    ssh_private_key_credentials: "ssh_credentials",
    sys_data_source: "sys_metadata",
    sys_rest_message_headers: "sys_metadata",
    sys_soap_message_parameters: "sys_metadata",
  },
  scopes: {},
  typedFields: { sys_data_source: { jdbc_password: "password2" } },
});

const withheld = (table: string, body: string) => withheldReason(payload(table, body), catalog);

describe("update payloads withheld from an export", () => {
  it("withholds credentials, secret fields and secret-like properties", () => {
    for (const [table, body] of [
      ["sys_auth_profile_basic", "<username>svc</username>"],
      ["sys_rest_message", "<name>Api</name><password>s3cret</password>"],
      ["sys_script_include", "<api_key><![CDATA[abc]]></api_key>"],
      ["sys_properties", "<name>x.integration.api_key</name><value>abc</value>"],
      ["sys_properties", "<name>x.mode</name><type>password2</type><value>abc</value>"],
    ] as const) {
      expect([table, body, withheld(table, body)]).not.toEqual([table, body, null]);
    }
  });

  // Spec 012, B-04: these were exported.
  it("withholds subclasses of credential classes, and fields the dictionary types as passwords", () => {
    expect(withheld("ssh_private_key_credentials", "<ssh_private_key>k</ssh_private_key>")).toBe(
      "ssh_private_key_credentials records hold credentials or certificates",
    );
    expect(withheld("sys_data_source", "<name>HR</name><jdbc_password>p</jdbc_password>")).toBe(
      "it sets the secret field jdbc_password",
    );
  });

  it("reads the class from the first element when the update doesn't name it", () => {
    const bare = (body: string) => `<?xml version="1.0"?><record_update>${body}</record_update>`;
    expect(
      withheldReason(bare('<discovery_credentials action="INSERT_OR_UPDATE"/>'), catalog),
    ).toBe("discovery_credentials records hold credentials or certificates");
    expect(withheldReason(bare('<sys_script action="INSERT_OR_UPDATE"/>'), catalog)).toBeNull();
    // Composite updates whose first element is not a class.
    for (const root of ["database", "sys_choice_set", "sys_ui_form_sections"]) {
      expect(withheldReason(bare(`<${root} name="incident"/>`), catalog)).toBeNull();
    }
  });

  it("withholds an update whose table it doesn't know", () => {
    expect(withheld("x_unknown_table", "<name>x</name>")).toBe(
      "snagentic could not read the class of x_unknown_table",
    );
    expect(withheldReason("<record_update/>", catalog)).toBe(
      "snagentic could not read the class of the record",
    );
  });

  it("keeps ordinary updates, and secret fields left empty", () => {
    for (const [table, body] of [
      ["sys_script", "<name>VIP</name><script>gs.info('token');</script>"],
      ["sys_rest_message", "<name>Api</name><password/>"],
      ["sys_rest_message", "<name>Api</name><password></password>"],
      ["sys_data_source", "<name>HR</name><jdbc_password/>"],
      ["sys_properties", "<name>x.mode</name><type>string</type><value>fast</value>"],
    ] as const) {
      expect(withheld(table, body)).toBeNull();
    }
  });

  // Credential-shaped values, built at runtime so the repository never holds one.
  const jwt = [
    "eyJ" + "hbGciOiJIUzI1NiJ9",
    "eyJzdWIiOiIx" + "MjM0NTY3ODkwIn0",
    "dBjftJeZ4CVP" + "mB92K27uhbUJU1p1r",
  ].join(".");
  const github = "gh" + "p_" + "0123456789abcdefghij" + "klmnopqrstuvwxyz";
  const aws = "AK" + "IA" + "IOSFODNN7" + "EXAMPLE";

  // ADR-0035: the value scan pull and adopt apply holds for export too.
  it("withholds an update whose payload holds a credential-shaped value, naming the pattern only", () => {
    for (const [table, body, pattern, value] of [
      [
        "sys_rest_message_headers",
        `<name>Authorization</name><value>Bearer ${jwt}</value>`,
        "jwt",
        jwt,
      ],
      [
        "sys_script_include",
        `<script><![CDATA[var t = "${github}";]]></script>`,
        "github-token",
        github,
      ],
      [
        "sys_soap_message_parameters",
        `<name>key</name><value>${aws}</value>`,
        "aws-access-key-id",
        aws,
      ],
    ] as const) {
      const reason = withheld(table, body);
      expect([table, reason]).toEqual([
        table,
        `it holds a value shaped like a secret (${pattern})`,
      ]);
      expect(reason).not.toContain(value);
    }
  });

  it("scans composite updates too", () => {
    const bare = `<?xml version="1.0"?><record_update><sys_choice_set name="incident"><label>${github}</label></sys_choice_set></record_update>`;
    expect(withheldReason(bare, catalog)).toBe(
      "it holds a value shaped like a secret (github-token)",
    );
  });
});
