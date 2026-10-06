import { describe, expect, it } from "bun:test";
import fc from "fast-check";
import { fromYamlStrings, toYaml } from "../../../src/adapters/yaml/own-style";
import { scanRecord } from "../../../src/adapters/yaml/record-scan";

const fieldName = fc.stringMatching(/^[a-z][a-z0-9_]{0,20}$/).filter((name) => name !== "_meta");

describe("scanRecord", () => {
  it("reads every single-line field and _meta value exactly as the YAML parser does", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fieldName, fc.string({ maxLength: 40 })),
        fc.dictionary(fieldName, fc.string({ maxLength: 40 })),
        (fields, meta) => {
          const text = toYaml({ _meta: meta, ...fields });
          const parsed = fromYamlStrings(text) as Record<string, unknown>;
          const scanned = scanRecord(text);
          for (const [key, value] of Object.entries(fields)) {
            if (!value.includes("\n")) {
              expect(scanned.fields[key]).toBe(String(parsed[key]));
            } else {
              expect(scanned.fields[key]).toBeUndefined();
            }
          }
          for (const [key, value] of Object.entries(meta)) {
            if (!value.includes("\n")) {
              expect(scanned.meta[key]).toBe(
                String((parsed["_meta"] as Record<string, unknown>)[key]),
              );
            }
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it("does not take the lines of a multi-line value for fields", () => {
    const text = toYaml({ _meta: { sys_id: "a" }, condition: "x: 1\nname: fake", name: "Real" });
    expect(scanRecord(text)).toEqual({ meta: { sys_id: "a" }, fields: { name: "Real" } });
  });
});
