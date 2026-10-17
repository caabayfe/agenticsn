import { describe, expect, it } from "bun:test";
import type { Row } from "@snagentic/core";
import { BEFORE, CHANGED, pulledInstance, sid, touch } from "../support/incremental-fixture";

// Whether a script runs on the latest ECMAScript engine is a row of its own, keyed by the
// script's sys_id (`id`) and class (`table`).
const UTIL = `global/sys_script_include/util--${sid(8)}`;
const ES_LATEST = `${UTIL}.children.sys_es_latest_script.yaml`;

const scriptInclude = (n: number, name: string, updated = BEFORE): Row => ({
  sys_id: sid(n),
  sys_class_name: "sys_script_include",
  name,
  sys_scope: "global",
  sys_updated_on: updated,
});

const esLatest = (sysId: string, owner: string, updated = BEFORE): Row => ({
  sys_id: sysId,
  id: owner,
  table: "sys_script_include",
  use_es_latest: "true",
  sys_updated_on: updated,
});

function withScriptInclude(tables: Record<string, Row[]>): void {
  tables["sys_db_object"]?.push({ sys_id: "c7", name: "sys_script_include", super_class: "c0" });
  tables["sys_script_include"] = [scriptInclude(8, "Util")];
  tables["sys_es_latest_script"] = [esLatest("es1", sid(8))];
}

describe("pull: ES-latest mode of script includes", () => {
  it("keeps a script include's ES-latest row beside it", async () => {
    const { files } = await pulledInstance(withScriptInclude);
    expect(files.get(ES_LATEST)).toEqual([
      expect.objectContaining({ sys_id: "es1", id: sid(8), use_es_latest: "true" }),
    ]);
  });

  it("refreshes a changed ES-latest row in an incremental pull", async () => {
    const { incremental, tables, files } = await pulledInstance(withScriptInclude);
    touch(tables["sys_es_latest_script"]?.[0], { use_es_latest: "false" });
    const { summary } = await incremental();
    expect(summary.changedSources).toEqual(["sys_es_latest_script"]);
    expect(files.get(ES_LATEST)).toEqual([
      expect.objectContaining({ sys_id: "es1", use_es_latest: "false" }),
    ]);
  });

  it("removes the ES-latest file when the row is deleted", async () => {
    const { incremental, tables, files } = await pulledInstance(withScriptInclude);
    tables["sys_es_latest_script"] = [];
    await incremental();
    expect(files.has(ES_LATEST)).toBe(false);
  });

  it("attaches the ES-latest row of a script include created since the last pull", async () => {
    const { incremental, tables, files } = await pulledInstance(withScriptInclude);
    tables["sys_script_include"]?.push(scriptInclude(9, "Fresh", CHANGED));
    tables["sys_es_latest_script"]?.push(esLatest("es2", sid(9), CHANGED));
    await incremental();
    expect(
      files.get(`global/sys_script_include/fresh--${sid(9)}.children.sys_es_latest_script.yaml`),
    ).toEqual([expect.objectContaining({ sys_id: "es2" })]);
  });

  it("lists every ES-latest row on the first pull after an upgrade", async () => {
    const { incremental, state, files } = await pulledInstance(withScriptInclude);
    const fingerprints = { ...state.saved.state?.fingerprints };
    delete fingerprints["sys_es_latest_script"];
    files.delete(ES_LATEST);
    if (state.saved.state !== null) {
      state.saved.state = { ...state.saved.state, fingerprints };
    }
    await incremental();
    expect(files.get(ES_LATEST)).toHaveLength(1);
  });
});
