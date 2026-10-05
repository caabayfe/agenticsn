import { describe, expect, it } from "bun:test";
import {
  artifactFromRow,
  Catalog,
  DEFAULT_REDACTION,
  parseRecord,
  recordBase,
  recordHash,
  renderRecord,
} from "@snagentic/core";

const catalog = new Catalog({
  parents: { sys_metadata: null, sys_script: "sys_metadata", sys_dictionary: "sys_metadata" },
  scopes: { aa11: "x_acme_app" },
  typedFields: { sys_script: { script: "script_server", password: "password2" } },
});

const ROW = {
  sys_id: "0123456789abcdef0123456789abcdef",
  sys_class_name: "sys_script",
  sys_scope: "aa11",
  sys_domain: "global",
  sys_mod_count: "4",
  sys_updated_on: "2026-10-01 10:00:00",
  sys_updated_by: "admin",
  sys_update_name: "sys_script_0123456789abcdef0123456789abcdef",
  name: "Raise Priority (VIP)",
  collection: "incident",
  script: "(function () {\r\n  gs.info('x');\r\n})();\r\n",
  condition: "",
  password: "hunter2",
};

describe("artifactFromRow", () => {
  const artifact = artifactFromRow(ROW, catalog, DEFAULT_REDACTION);

  it("separates identity and provenance from content fields", () => {
    expect(JSON.parse(JSON.stringify(artifact.identity))).toEqual({
      sysId: ROW.sys_id,
      className: "sys_script",
      scope: "x_acme_app",
      domain: "global",
    });
    expect(artifact.meta).toMatchObject({
      sys_mod_count: "4",
      sys_update_name: ROW.sys_update_name,
    });
    expect(Object.keys(artifact.fields)).not.toContain("sys_mod_count");
  });

  it("never keeps a secret value, and records that it was redacted", () => {
    expect(artifact.fields).not.toHaveProperty("password");
    expect(artifact.redacted).toEqual(["password"]);
  });

  it("hashes the content fields with hash contract v1", () => {
    expect(artifact.hash).toBe(recordHash("sys_script", artifact.fields));
  });

  it("rejects a row without a valid sys_id or class", () => {
    expect(() => artifactFromRow({ ...ROW, sys_id: "../x" }, catalog, DEFAULT_REDACTION)).toThrow();
    expect(() =>
      artifactFromRow({ ...ROW, sys_class_name: "Bad Class" }, catalog, DEFAULT_REDACTION),
    ).toThrow();
  });
});

describe("flat record layout (ADR-0017)", () => {
  const artifact = artifactFromRow(ROW, catalog, DEFAULT_REDACTION);

  it("places a record at <scope>/<class>/<slug>--<sys_id>", () => {
    expect(recordBase(artifact)).toBe(
      "x_acme_app/sys_script/raise-priority-vip--0123456789abcdef0123456789abcdef",
    );
  });

  it("places records of other domains under domains/<domain>/", () => {
    const other = artifactFromRow({ ...ROW, sys_domain: "c90d" }, catalog, DEFAULT_REDACTION);
    expect(recordBase(other)).toStartWith("domains/c90d/x_acme_app/sys_script/");
  });

  it.each([
    [{ sys_name: "Display", name: "Name" }, "/display--"],
    [{ name: "", api_name: "x_acme.Util" }, "/x-acme-util--"],
    [{ name: "", element: "u_vip" }, "/u-vip--"],
    [{ name: "" }, "/record--"],
  ])("names the record after its first non-empty name field (%p)", (names, expected) => {
    const named = artifactFromRow({ ...ROW, ...names }, catalog, DEFAULT_REDACTION);
    expect(recordBase(named)).toContain(expected);
  });

  it("writes non-empty script fields as sibling files and keeps everything else in the YAML", () => {
    const rendered = renderRecord(artifact, catalog);
    expect(rendered.files).toEqual([
      {
        path: `${rendered.base}.script.js`,
        content: "(function () {\n  gs.info('x');\n})();\n",
      },
    ]);
    expect(rendered.document).toMatchObject({
      name: "Raise Priority (VIP)",
      collection: "incident",
      condition: "",
    });
    expect(rendered.document).not.toHaveProperty("script");
    expect(rendered.document["_meta"]).toMatchObject({
      sys_id: ROW.sys_id,
      scope: "x_acme_app",
      hash: artifact.hash,
      redacted: ["password"],
    });
  });

  it("reads back exactly what it rendered, with the same hash", () => {
    const rendered = renderRecord(artifact, catalog);
    const files = rendered.files.map((file) => ({ field: "script", content: file.content }));
    const parsed = parseRecord(rendered.document, files);
    expect(parsed.artifact.fields).toEqual(artifact.fields);
    expect(parsed.artifact.hash).toBe(artifact.hash);
    expect(parsed.storedHash).toBe(artifact.hash);
  });

  it("reports a document without identity as unreadable", () => {
    expect(() => parseRecord({ name: "x" }, [])).toThrow(
      expect.objectContaining({ code: "invalid-record" }),
    );
  });
});
