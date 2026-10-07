import { describe, expect, it } from "bun:test";
import { withheldReason } from "@snagentic/core";

const payload = (table: string, body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><record_update table="${table}"><${table} action="INSERT_OR_UPDATE">${body}</${table}></record_update>`;

describe("update payloads withheld from an export", () => {
  it("withholds credentials, secret fields and secret-like properties", () => {
    for (const [table, body] of [
      ["sys_auth_profile_basic", "<username>svc</username>"],
      ["sys_rest_message", "<name>Api</name><password>s3cret</password>"],
      ["sys_script_include", "<api_key><![CDATA[abc]]></api_key>"],
      ["sys_properties", "<name>x.integration.api_key</name><value>abc</value>"],
      ["sys_properties", "<name>x.mode</name><type>password2</type><value>abc</value>"],
    ] as const) {
      expect([table, body, withheldReason(payload(table, body))]).not.toEqual([table, body, null]);
    }
  });

  it("keeps ordinary updates, and secret fields left empty", () => {
    for (const [table, body] of [
      ["sys_script", "<name>VIP</name><script>gs.info('token');</script>"],
      ["sys_rest_message", "<name>Api</name><password/>"],
      ["sys_rest_message", "<name>Api</name><password></password>"],
      ["sys_properties", "<name>x.mode</name><type>string</type><value>fast</value>"],
    ] as const) {
      expect(withheldReason(payload(table, body))).toBeNull();
    }
    expect(withheldReason("<record_update/>")).toBeNull();
  });
});
