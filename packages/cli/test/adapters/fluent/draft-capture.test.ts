import { expect, it } from "bun:test";
import { draftContentAgrees, publishedCapture } from "@snagentic/core";
import { builtUnitOf } from "../../../src/adapters/fluent/built-units";
import { decodeCapture } from "../../../src/adapters/fluent/capture-decoder";

const ROOT = new URL(
  "../../../../../tests/fixtures/p1-delivery/pdi13-draft-2026-11-17/",
  import.meta.url,
);
const IDS = [
  "3ad20e12b1523d5738e3e890f3a625ff",
  "a3423c7421df98a9a2d4418906bd62e6",
  "dc3159a909ded6793ee4603e8b142b6f",
  "e47d7a531b022ca88a2ff402a3a3d0d1",
  "ed65090d7166e0e0d5dc7d622dc4413d",
];
async function fixture(id = IDS[0] ?? "") {
  const name = `sys_hub_flow_${id}`;
  const built = builtUnitOf(`${name}.xml`, await Bun.file(new URL(`${id}-built.xml`, ROOT)).text());
  const capture = decodeCapture(name, await Bun.file(new URL(`${id}-capture.xml`, ROOT)).text());
  if (capture === null) throw new Error("Recorded native draft must decode completely");
  return { built, actual: capture.unit };
}

for (const id of IDS) {
  it(`matches the recorded raw PDI13 draft ${id} without treating it as published delivery`, async () => {
    const { built, actual } = await fixture(id);
    expect(draftContentAgrees(built, actual)).toBe(true);
    expect(publishedCapture(actual)).toBe(false);
  });
}

for (const [name, fields] of Object.entries({
  published: { status: "published" },
  active: { active: "true" },
  "master snapshot": { master_snapshot: "f".repeat(32) },
  "latest snapshot": { latest_snapshot: "f".repeat(32) },
  "changed name": { name: "External" },
})) {
  it(`refuses a ${name} mutation of a recorded native draft`, async () => {
    const { built, actual } = await fixture();
    const changed = {
      ...actual,
      head: { ...actual.head, fields: { ...actual.head.fields, ...fields } },
    };
    expect(draftContentAgrees(built, changed)).toBe(false);
  });
}

it("requires the same flow identity and table", async () => {
  const { built, actual } = await fixture();
  expect(
    draftContentAgrees(built, { ...actual, head: { ...actual.head, table: "sys_script_include" } }),
  ).toBe(false);
  expect(
    draftContentAgrees(built, { ...actual, head: { ...actual.head, sysId: "f".repeat(32) } }),
  ).toBe(false);
});

it("refuses changed, missing, duplicate and additional authored rows in a native draft", async () => {
  const { built, actual } = await fixture();
  const rows = actual.children.filter((row) => row.sysId !== "");
  const first = rows[0];
  if (first === undefined || rows.length < 2)
    throw new Error("Fixture must contain an authored graph");
  expect(draftContentAgrees(built, { ...actual, children: rows.slice(1) })).toBe(false);
  expect(
    draftContentAgrees(built, { ...actual, children: [...rows.slice(1), rows[1] ?? first] }),
  ).toBe(false);
  expect(
    draftContentAgrees(built, {
      ...actual,
      children: [{ ...first, fields: {} }, ...rows.slice(1)],
    }),
  ).toBe(false);
  expect(
    draftContentAgrees(built, {
      ...actual,
      children: [...rows, { ...first, sysId: "f".repeat(32) }],
    }),
  ).toBe(false);
});
