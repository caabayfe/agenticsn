import { describe, expect, it } from "bun:test";
import type { Row } from "@snagentic/core";
import { BEFORE, pulledInstance, SECTION, sid, touch } from "../support/incremental-fixture";

// A record or row in a domain the session's domain doesn't see: the instance hides it from any
// listing that doesn't ask for every domain (ADR-0030 #9).
const elsewhere = (row: Row): Row => ({ ...row, sys_domain: "d-acme", __other_domain: "true" });

// Records outside the global domain live under domains/<domain> (ADR-0027).
const OTHER_RULE = `domains/d-acme/global/sys_script/acme-rule--${sid(7)}`;
const otherRule = (): Row =>
  elsewhere({
    sys_id: sid(7),
    sys_class_name: "sys_script",
    name: "Acme rule",
    sys_scope: "global",
    sys_updated_on: BEFORE,
    script: "acme();",
  });

describe("pull: records in other domains", () => {
  it("lists records and child rows of every domain in a full pull", async () => {
    const { files } = await pulledInstance((tables) => {
      tables["sys_script"]?.push(otherRule());
      tables["sys_ui_element"]?.push(
        elsewhere({ sys_id: "e9", sys_ui_section: sid(4), element: "company" }),
      );
    });
    expect(files.has(`${OTHER_RULE}.yaml`)).toBe(true);
    expect(files.get(`${SECTION}.children.sys_ui_element.yaml`)).toContainEqual(
      expect.objectContaining({ sys_id: "e9" }),
    );
  });

  it("picks up a change to a record in another domain", async () => {
    const { incremental, tables, files } = await pulledInstance((data) => {
      data["sys_script"]?.push(otherRule());
    });
    touch(
      tables["sys_script"]?.find((row) => row["sys_id"] === sid(7)),
      { script: "moved();" },
    );
    const { summary } = await incremental();
    expect(summary.records).toBe(1);
    expect(files.get(`${OTHER_RULE}.script.js`)).toBe("moved();\n");
  });

  it("refreshes the child rows of an owner when a row in another domain changed", async () => {
    const { incremental, tables, files } = await pulledInstance((data) => {
      data["sys_ui_element"]?.push(
        elsewhere({ sys_id: "e9", sys_ui_section: sid(4), element: "company" }),
      );
    });
    touch(
      tables["sys_ui_element"]?.find((row) => row["sys_id"] === "e9"),
      { element: "location" },
    );
    await incremental();
    expect(files.get(`${SECTION}.children.sys_ui_element.yaml`)).toContainEqual(
      expect.objectContaining({ sys_id: "e9", element: "location" }),
    );
  });

  it("recovers a record in another domain when verifying", async () => {
    const { incremental, tables, files } = await pulledInstance();
    tables["sys_script"]?.push(otherRule());
    const { summary } = await incremental({ verify: true });
    expect(summary.verification).toMatchObject({ recovered: 1 });
    expect(files.has(`${OTHER_RULE}.yaml`)).toBe(true);
  });

  it("keeps the session's domain for the operational inventory", async () => {
    const { incremental } = await pulledInstance();
    const { queries } = await incremental({ verify: true });
    const inventory = queries.filter((query) => String(query.table) === "v_plugin");
    expect(inventory.length).toBeGreaterThan(0);
    expect(inventory.every((query) => query.allDomains !== true)).toBe(true);
  });
});
