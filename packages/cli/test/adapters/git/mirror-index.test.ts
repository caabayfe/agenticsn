import { heapStats } from "bun:jsc";
import { describe, expect, it } from "bun:test";
import fc from "fast-check";
import { MirrorIndex } from "../../../src/adapters/git/mirror-index";
import { ReferenceMirrorIndex } from "../../support/reference-mirror-index";

const ROOT = "instances/pdi/metadata/";
const RULE = `${ROOT}global/sys_script/rule--0001`;
const FLOW = `${ROOT}global/sys_hub_flow/my-flow--0002`;

const index = () =>
  MirrorIndex.fromPaths([
    `${RULE}.yaml`,
    `${RULE}.script.js`,
    `${FLOW}.yaml`,
    `${FLOW}.children.sys_hub_action_instance_v2.yaml`,
    "instances/pdi/operational/v_plugin.yaml",
  ]);

describe("MirrorIndex", () => {
  it("groups every file of a record under its base", () => {
    expect(index().filesOf(RULE)).toEqual([`${RULE}.yaml`, `${RULE}.script.js`]);
    expect(index().filesOf(FLOW)).toEqual([
      `${FLOW}.yaml`,
      `${FLOW}.children.sys_hub_action_instance_v2.yaml`,
    ]);
  });

  it("finds a record's base by its sys_id", () => {
    expect(index().baseOf("0002")).toBe(FLOW);
    expect(index().baseOf("9999")).toBeUndefined();
  });

  it("lists record bases under a prefix, ignoring files that are not records", () => {
    expect([...index().bases(ROOT)].sort()).toEqual([
      "global/sys_hub_flow/my-flow--0002",
      "global/sys_script/rule--0001",
    ]);
    expect([...index().bases("instances/pdi/operational/")]).toEqual([]);
  });

  it("forgets a record once its last file is removed", () => {
    const tree = index();
    tree.remove(`${RULE}.script.js`);
    expect(tree.filesOf(RULE)).toEqual([`${RULE}.yaml`]);
    tree.remove(`${RULE}.yaml`);
    expect(tree.filesOf(RULE)).toEqual([]);
    expect(tree.baseOf("0001")).toBeUndefined();
  });

  it("follows a renamed record to its new base", () => {
    const tree = index();
    const renamed = `${ROOT}global/sys_script/better-rule--0001`;
    tree.remove(`${RULE}.yaml`);
    tree.remove(`${RULE}.script.js`);
    tree.add(`${renamed}.yaml`);
    expect(tree.baseOf("0001")).toBe(renamed);
  });

  it("does not list a file twice when it is written again", () => {
    const tree = index();
    tree.add(`${RULE}.yaml`);
    expect(tree.filesOf(RULE)).toHaveLength(2);
  });
});

describe("MirrorIndex against the index it replaced (PERF-07)", () => {
  const segment = fc.constantFrom("global", "x_acme", "sys_script", "sys_ui_view", "ünï");
  const slug = fc.constantFrom("rule", "my-flow", "Default view", "naïve", "a");
  const sysId = fc.constantFrom("0001", "0002", "0003", "abc", "Default view");
  const suffix = fc.constantFrom(".yaml", ".script.js", ".children.sys_ui_element.yaml");
  const path = fc
    .tuple(fc.array(segment, { maxLength: 3 }), slug, sysId, suffix)
    .map(([dirs, name, id, end]) => [...dirs, `${name}--${id}${end}`].join("/"));
  const operation = fc.oneof(
    fc.record({ kind: fc.constant("add" as const), path }),
    fc.record({ kind: fc.constant("remove" as const), path }),
    fc.record({ kind: fc.constant("add" as const), path: fc.constant("ops/v_plugin.yaml") }),
  );
  const prefixes = ["", "global/", "x_acme/sys_script/", "global/sys_script/rule", "ünï/"];

  it("answers every question as the old index did, through any adds and removes", () => {
    fc.assert(
      fc.property(fc.array(operation, { maxLength: 80 }), (operations) => {
        const compact = new MirrorIndex();
        const reference = new ReferenceMirrorIndex();
        for (const { kind, path } of operations) {
          compact[kind](path);
          reference[kind](path);
        }
        for (const prefix of prefixes) {
          expect([...compact.bases(prefix)]).toEqual([...reference.bases(prefix)]);
        }
        for (const id of ["0001", "0002", "0003", "abc", "Default view", "none"]) {
          expect(compact.baseOf(id)).toBe(reference.baseOf(id));
        }
        for (const base of reference.bases("")) {
          expect(compact.filesOf(base)).toEqual(reference.filesOf(base));
        }
        for (const { path } of operations) {
          const base = path.slice(0, path.indexOf(".", path.lastIndexOf("/") + 1));
          expect(compact.filesOf(base)).toEqual(reference.filesOf(base));
        }
      }),
      { numRuns: 500 },
    );
  });

  it("keeps finding records after its tables grow past their first size", () => {
    const paths = Array.from(
      { length: 5000 },
      (_, n) => `global/sys_script/rule-${n}--${n.toString(16).padStart(32, "0")}.yaml`,
    );
    const compact = MirrorIndex.fromPaths(paths);
    for (let n = 0; n < 5000; n += 2) compact.remove(paths[n] ?? "");
    for (let n = 0; n < 5000; n += 1) {
      const id = n.toString(16).padStart(32, "0");
      expect(compact.baseOf(id)).toBe(
        n % 2 === 0 ? undefined : `global/sys_script/rule-${n}--${id}`,
      );
    }
    expect([...compact.bases("global/")]).toHaveLength(2500);
  });
});

describe("MirrorIndex memory (PERF-07)", () => {
  it("holds a record in about a third of the memory a Map entry per base and sys_id took", () => {
    const records = 200_000;
    const measure = (build: () => unknown) => {
      Bun.gc(true);
      const before = heapStats().heapSize;
      const index = build();
      Bun.gc(true);
      const bytes = heapStats().heapSize - before;
      expect(index).toBeDefined();
      return bytes / records;
    };
    function* paths() {
      for (let n = 0; n < records; n += 1) {
        const base = `instances/pdi/metadata/x_acme_${n % 40}/sys_script_include/record_name_${n}--${n.toString(16).padStart(32, "0")}`;
        yield `${base}.yaml`;
        if (n % 3 === 0) yield `${base}.script.js`;
      }
    }
    const compact = measure(() => MirrorIndex.fromPaths(paths()));
    const reference = measure(() => ReferenceMirrorIndex.fromPaths(paths()));
    // Measured: ~120 bytes a record, against ~330 (2M records: 243 MB against 671 MB).
    expect(compact).toBeLessThan(160);
    expect(compact * 2).toBeLessThan(reference);
  });
});
