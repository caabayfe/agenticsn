import { describe, expect, it } from "bun:test";
import { AdoptSecretError, adopt, type BuiltUnit, type CatalogData } from "@snagentic/core";
import { fakeInstance } from "../support/fake-instance";
import { memoryToolchain, memoryWorkspace } from "../support/memory-authoring";
import { record, SCRIPT_INCLUDE_ID, scriptInclude, unit } from "./units";

const SCOPE_ID = "489da54ae67c4a3e9f1e1e4347e9119b";
const signal = new AbortController().signal;
const access = {
  host: "https://instance.example.com/",
  exchange: async () => ({ status: 500, contentType: "", text: "" }),
};
const SECRET = "hunter2-very-secret";

const instance = (dictionary: Record<string, string>[] = []) =>
  fakeInstance({
    sys_script_include: [
      { sys_id: SCRIPT_INCLUDE_ID, sys_class_name: "sys_script_include", sys_scope: SCOPE_ID },
    ],
    sys_properties: [
      { sys_id: "c".repeat(32), sys_class_name: "sys_properties", sys_scope: SCOPE_ID },
    ],
    sys_cred: [{ sys_id: "d".repeat(32), sys_class_name: "sys_cred", sys_scope: SCOPE_ID }],
    sys_scope: [{ sys_id: SCOPE_ID, scope: "x_2222332_s11", sys_class_name: "sys_app" }],
    sys_dictionary: dictionary,
  });

const withField = (field: string, value: string): BuiltUnit => {
  const base = scriptInclude("Helpers.");
  return { ...base, head: { ...base.head, fields: { ...base.head.fields, [field]: value } } };
};

async function adopting(
  units: readonly BuiltUnit[],
  table: string,
  sysId: string,
  options: { dictionary?: Record<string, string>[]; catalog?: CatalogData } = {},
) {
  const fake = instance(options.dictionary);
  const { workspace, ledgers, written } = memoryWorkspace();
  const result = adopt(
    {
      reader: fake.reader,
      workspace,
      toolchain: memoryToolchain({ after: units, before: [] }).chain,
      access,
      signal,
      ...(options.catalog === undefined ? {} : { catalog: options.catalog }),
    },
    { instance: "pdi2", records: [{ table, sysId }] },
  );
  return { result, written, ledgers, queries: fake.queries };
}

// Security finding S2: adopt never puts in source what a pull keeps out of the mirror.
describe("adopt: secrets", () => {
  it("refuses a record whose build carries a password field, writing nothing", async () => {
    const run = await adopting(
      [withField("u_key", SECRET)],
      "sys_script_include",
      SCRIPT_INCLUDE_ID,
      {
        dictionary: [{ name: "sys_script_include", element: "u_key", internal_type: "password2" }],
      },
    );
    await expect(run.result).rejects.toBeInstanceOf(AdoptSecretError);
    await expect(run.result).rejects.toThrow(`sys_script_include_${SCRIPT_INCLUDE_ID}: u_key`);
    expect(run.written.size).toBe(0);
    expect(run.ledgers.size).toBe(0);
  });

  it("never names the secret value", async () => {
    const run = await adopting(
      [withField("password", SECRET)],
      "sys_script_include",
      SCRIPT_INCLUDE_ID,
    );
    const error = await run.result.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AdoptSecretError);
    expect(JSON.stringify(error)).not.toContain(SECRET);
    expect(String(error)).not.toContain(SECRET);
  });

  it("refuses a field named like a secret even without a dictionary type", async () => {
    const run = await adopting(
      [withField("client_secret", SECRET)],
      "sys_script_include",
      SCRIPT_INCLUDE_ID,
    );
    await expect(run.result).rejects.toBeInstanceOf(AdoptSecretError);
  });

  it("refuses a property whose value a pull would redact", async () => {
    const property = unit(
      "sys_properties_x",
      record("sys_properties", "c".repeat(32), {
        name: "x_acme.endpoint",
        type: "string",
        is_private: "false",
        value: "https://example.test/?token=abc",
      }),
    );
    const run = await adopting([property], "sys_properties", "c".repeat(32));
    await expect(run.result).rejects.toThrow("sys_properties_x: value");
  });

  it("refuses a record of a class the mirror never holds, such as credentials", async () => {
    const credential = unit("sys_cred_x", record("sys_cred", "d".repeat(32), { name: "Basic" }));
    const run = await adopting([credential], "sys_cred", "d".repeat(32));
    await expect(run.result).rejects.toThrow("sys_cred_x: sys_cred is never kept");
  });

  it("lets an empty secret field through", async () => {
    const run = await adopting(
      [withField("password", "")],
      "sys_script_include",
      SCRIPT_INCLUDE_ID,
    );
    const error = await run.result.catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(AdoptSecretError);
  });

  it("uses the workspace's catalog when it has one, without reading the dictionary", async () => {
    const catalog: CatalogData = {
      parents: { sys_script_include: null },
      scopes: {},
      typedFields: { sys_script_include: { u_key: "password2" } },
    };
    const run = await adopting(
      [withField("u_key", SECRET)],
      "sys_script_include",
      SCRIPT_INCLUDE_ID,
      {
        catalog,
      },
    );
    await expect(run.result).rejects.toBeInstanceOf(AdoptSecretError);
    expect(run.queries.some((query) => String(query.table) === "sys_dictionary")).toBe(false);
  });
});
