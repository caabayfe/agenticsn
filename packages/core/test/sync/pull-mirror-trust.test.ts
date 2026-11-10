import { describe, expect, it } from "bun:test";
import { SECRET_SCAN_VERSION } from "@snagentic/core";
import { pulledInstance, RULE, sid, touch } from "../support/incremental-fixture";

// Spec 014, SEC2-03: a mirror commit may come from anyone who can push the mirror branch. Its
// catalog and versions are data; redaction relies on what this clone read from the instance.
const PLACEHOLDER = "placeholder-not-a-credential";

// The instance types sys_script.jdbc_pass as a password, which only the catalog says.
async function withPasswordField() {
  return pulledInstance((tables) => {
    tables["sys_dictionary"]?.push({
      sys_id: "d2",
      name: "sys_script",
      element: "jdbc_pass",
      internal_type: "password2",
    });
  });
}

const readsCatalog = (queries: readonly { readonly table: string }[]) =>
  queries.some((query) => query.table === "sys_db_object");

const written = (files: ReadonlyMap<string, unknown>, path: string) =>
  JSON.stringify(files.get(path) ?? null);

describe("pullIncremental: the mirror's catalog is data, not trust", () => {
  it("reads the catalog from the instance before writing records when the mirror's differs from what this clone read", async () => {
    const pulled = await withPasswordField();
    const { incremental, tables, files, state } = pulled;
    const stored = state.saved.catalog;
    if (stored === null) throw new Error("the fixture did not complete its full pull");
    // The commit this clone continues from says the field is plain text.
    state.saved.catalog = { ...stored, typedFields: { sys_script: { script: "script_server" } } };
    touch(tables["sys_script"]?.[0], { jdbc_pass: PLACEHOLDER });
    const { summary, queries } = await incremental();
    expect(readsCatalog(queries)).toBe(true);
    expect(written(files, `${RULE}.yaml`)).toContain('"redacted":["jdbc_pass"]');
    expect(written(files, `${RULE}.yaml`)).not.toContain(PLACEHOLDER);
    expect(summary.catalogRefreshed).toBe(true);
    expect(summary.idle).toBe(false);
    expect(state.saved.catalog?.typedFields["sys_script"]).toMatchObject({
      jdbc_pass: "password2",
    });
  });

  it("refuses a class the mirror's catalog moved out from under a credential class", async () => {
    const pulled = await pulledInstance((tables) => {
      tables["sys_db_object"]?.push({ sys_id: "c7", name: "x_acme_cred", super_class: "c5" });
      tables["x_acme_cred"] = [];
    });
    const { incremental, tables, files, state } = pulled;
    const stored = state.saved.catalog;
    if (stored === null) throw new Error("the fixture did not complete its full pull");
    state.saved.catalog = {
      ...stored,
      parents: { ...stored.parents, x_acme_cred: "sys_metadata" },
    };
    tables["x_acme_cred"]?.push({
      sys_id: sid(11),
      sys_class_name: "x_acme_cred",
      name: "Acme",
      sys_scope: "global",
      sys_updated_on: "2026-10-05 10:30:00",
    });
    const { queries } = await incremental();
    expect(queries.some((query) => query.table === "x_acme_cred")).toBe(false);
    expect([...files.keys()].some((path) => path.includes("x_acme_cred"))).toBe(false);
  });

  it("relies on a catalog this clone read itself, at no cost to the instance", async () => {
    const { incremental, tables, files } = await withPasswordField();
    touch(tables["sys_script"]?.[0], { jdbc_pass: PLACEHOLDER });
    const { queries } = await incremental();
    expect(readsCatalog(queries)).toBe(false);
    expect(written(files, `${RULE}.yaml`)).toContain('"redacted":["jdbc_pass"]');
    expect(written(files, `${RULE}.yaml`)).not.toContain(PLACEHOLDER);
  });

  it("reads nothing more when nothing changed, whatever the mirror's catalog says", async () => {
    const { incremental, state } = await withPasswordField();
    const stored = state.saved.catalog;
    if (stored === null) throw new Error("the fixture did not complete its full pull");
    state.saved.catalog = { ...stored, typedFields: {} };
    const { queries, summary } = await incremental();
    expect(queries).toEqual([]);
    expect(summary.idle).toBe(true);
  });
});

describe("pullIncremental: versions from the mirror", () => {
  it("scans the committed files again when the recorded scan version is above its own", async () => {
    const { incremental, state, prepared } = await pulledInstance();
    const current = state.saved.state;
    if (current === null) throw new Error("the fixture did not complete its full pull");
    state.saved.state = { ...current, secretScanVersion: SECRET_SCAN_VERSION + 97 };
    const before = prepared();
    const { summary } = await incremental();
    expect(prepared()).toBe(before + 1);
    expect(summary.idle).toBe(false);
    expect(summary.next.secretScanVersion).toBe(SECRET_SCAN_VERSION);
  });

  it("re-reads what the redaction policy covers when the recorded version is above its own", async () => {
    const { incremental, state } = await pulledInstance();
    const current = state.saved.state;
    if (current === null) throw new Error("the fixture did not complete its full pull");
    state.saved.state = { ...current, redactionVersion: 99 };
    const { summary } = await incremental();
    expect(summary.rereadForRedaction.length).toBeGreaterThan(0);
    expect(summary.idle).toBe(false);
  });
});
