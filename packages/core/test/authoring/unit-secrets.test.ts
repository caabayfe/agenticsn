import { describe, expect, it } from "bun:test";
import { Catalog, DEFAULT_REDACTION, unitSecrets } from "@snagentic/core";
import { record, unit } from "./units";

const catalog = new Catalog({ parents: {}, scopes: {}, typedFields: {} });

// S2 keeps credentials out of source; classes the mirror skips for other reasons are not
// secrets (a UI policy action's translated message).
describe("unitSecrets", () => {
  it("refuses a credential class", () => {
    const credential = unit("sys_cred_x", record("sys_cred", "a".repeat(32), { name: "Basic" }));
    expect(unitSecrets([credential], catalog, DEFAULT_REDACTION)).toEqual([
      "sys_cred_x: sys_cred is never kept",
    ]);
  });

  it("lets a translation through: it is not a secret", () => {
    const translation = unit(
      "sys_ui_policy_action_x",
      record("sys_ui_policy_action", "b".repeat(32), { field: "state" }),
      [record("sys_translated_text", "c".repeat(32), { value: "Etat", language: "fr" })],
    );
    expect(unitSecrets([translation], catalog, DEFAULT_REDACTION)).toEqual([]);
  });
});
