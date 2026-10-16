import { describe, expect, it } from "bun:test";
import {
  EMPTY_LEDGER,
  InvalidLedgerError,
  type LedgerEntry,
  ledgerDocument,
  ledgerOf,
  unitDigest,
  withEntries,
} from "@snagentic/core";
import fc from "fast-check";
import { record, revocationList, unit } from "./units";

const PATH = "source/x_2222332_s11/snagentic.ledger.yaml";
const entry: LedgerEntry = { build: "b1", instance: "1|2026-10-16 06:30:48", losses: [] };

describe("ledger (ADR-0033 item 3)", () => {
  it("reads a missing file as an empty ledger", () => {
    expect(ledgerOf(PATH, null)).toBe(EMPTY_LEDGER);
  });

  it("writes entries sorted, and the losses only when there are some", () => {
    const ledger = withEntries(
      EMPTY_LEDGER,
      "pdi2",
      new Map([
        ["sys_script_b", entry],
        ["sys_script_a", { ...entry, losses: ["script-format", "api-default"] }],
      ]),
    );
    expect(JSON.stringify(ledgerDocument(ledger))).toBe(
      JSON.stringify({
        pdi2: {
          sys_script_a: {
            build: "b1",
            instance: entry.instance,
            losses: ["api-default", "script-format"],
          },
          sys_script_b: { build: "b1", instance: entry.instance },
        },
      }),
    );
  });

  it("removes an entry, and an instance left without entries", () => {
    const one = withEntries(EMPTY_LEDGER, "pdi2", new Map([["u", entry]]));
    expect(ledgerDocument(withEntries(one, "pdi2", new Map([["u", undefined]])))).toEqual({});
  });

  it("refuses an entry it cannot trust", () => {
    expect(() => ledgerOf(PATH, { pdi2: { u: { build: "b1" } } })).toThrow(InvalidLedgerError);
    expect(() => ledgerOf(PATH, { pdi2: { u: { ...entry, losses: ["made-up"] } } })).toThrow(
      InvalidLedgerError,
    );
  });

  it("reads back what it writes", () => {
    const entries = fc.dictionary(
      fc.stringMatching(/^[a-z_0-9]{1,20}$/),
      fc.record({
        build: fc.stringMatching(/^[0-9a-f]{1,32}$/),
        instance: fc.string(),
        losses: fc.uniqueArray(
          fc.constantFrom("api-default", "script-format", "form-columns" as const),
        ),
      }),
    );
    fc.assert(
      fc.property(fc.dictionary(fc.stringMatching(/^[a-z0-9]{1,8}$/), entries), (document) => {
        const ledger = ledgerOf(PATH, document);
        expect(ledgerOf(PATH, ledgerDocument(ledger))).toEqual(ledger);
      }),
    );
  });
});

describe("unitDigest", () => {
  it("is the same for two builds that differ only in a named view's placeholder", () => {
    const build = (placeholder: string) =>
      unit(
        "sys_ui_list_x_t_mobile",
        record(
          "sys_ui_list",
          "c".repeat(32),
          { name: "x_t", view: placeholder },
          { view: "Mobile" },
        ),
      );
    expect(unitDigest(build("1".repeat(32)))).toBe(unitDigest(build("2".repeat(32))));
  });

  it("does not depend on the order of a unit's rows, and changes with their content", () => {
    const list = revocationList(["number", "state", "outcome"]);
    fc.assert(
      fc.property(
        fc.shuffledSubarray([...list.children], { minLength: 3, maxLength: 3 }),
        (rows) => {
          expect(unitDigest({ ...list, children: rows })).toBe(unitDigest(list));
        },
      ),
    );
    expect(unitDigest(revocationList(["number", "outcome", "state"]))).not.toBe(unitDigest(list));
  });
});
