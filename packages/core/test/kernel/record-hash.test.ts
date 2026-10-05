import { describe, expect, it } from "bun:test";
import { HASH_EXCLUDED_FIELDS, recordHash } from "@snagentic/core";
import fc from "fast-check";

interface Vector {
  readonly name: string;
  readonly class: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly hash: string;
}

async function loadVectors(file: string): Promise<readonly Vector[]> {
  const data: { vectors: Vector[] } = await Bun.file(`tests/fixtures/${file}`).json();
  return data.vectors;
}

describe("recordHash (hash contract v1)", () => {
  it("reproduces every vector from snagentic v1", async () => {
    for (const vector of await loadVectors("hash-vectors.json")) {
      expect({ name: vector.name, hash: recordHash(vector.class, vector.fields) }).toEqual({
        name: vector.name,
        hash: vector.hash,
      });
    }
  });

  it("reproduces every extended vector computed by the v1 Python code", async () => {
    const vectors = await loadVectors("hash-vectors-extended.json");
    expect(vectors.length).toBeGreaterThanOrEqual(2000);
    const mismatches = vectors.filter((v) => recordHash(v.class, v.fields) !== v.hash);
    expect(mismatches.map((v) => v.name)).toEqual([]);
  });

  it("gives the same hash for CRLF and LF versions of a script", () => {
    expect(recordHash("sys_script", { script: "a\r\nb\r\n" })).toBe(
      recordHash("sys_script", { script: "a\nb" }),
    );
  });

  it("treats a null field like an empty one", () => {
    expect(recordHash("sys_script", { description: null })).toBe(
      recordHash("sys_script", { description: "" }),
    );
  });

  it("does not depend on the order fields are supplied in", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.string()), (fields) => {
        const reversed = Object.fromEntries(Object.entries(fields).reverse());
        return recordHash("sys_script", fields) === recordHash("sys_script", reversed);
      }),
    );
  });

  it("changes when any field value changes", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.string(), { minKeys: 1 }),
        fc.string({ minLength: 1 }).filter((suffix) => !/^[\r\n]+$/.test(suffix)),
        (fields, suffix) => {
          const [key, value] = Object.entries(fields)[0] ?? ["", ""];
          const changed = { ...fields, [key]: `${value}${suffix}` };
          return recordHash("sys_script", fields) !== recordHash("sys_script", changed);
        },
      ),
    );
  });

  it("returns a lowercase 64-character hex digest", () => {
    expect(recordHash("sys_script", {})).toMatch(/^[0-9a-f]{64}$/);
  });

  it("lists the v1 identity and provenance fields as excluded from hashing", () => {
    expect([...HASH_EXCLUDED_FIELDS].sort()).toEqual(
      [
        "sys_class_name",
        "sys_created_by",
        "sys_created_on",
        "sys_domain",
        "sys_domain_path",
        "sys_id",
        "sys_mod_count",
        "sys_package",
        "sys_scope",
        "sys_tags",
        "sys_update_name",
        "sys_updated_by",
        "sys_updated_on",
      ].sort(),
    );
  });
});
