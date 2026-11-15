import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { capturedContentAgrees } from "@snagentic/core";
import { builtUnitOf } from "../../../src/adapters/fluent/built-units";
import { decodeCapture } from "../../../src/adapters/fluent/capture-decoder";

const NAME = "sys_hub_flow_8a924849cd84412081573bb363ec4326";
const source = readFileSync(
  join(
    import.meta.dir,
    `../../../../../tests/fixtures/fluent/s11-flows/expected/update/${NAME}.xml`,
  ),
  "utf8",
);
const built = builtUnitOf(`${NAME}.xml`, source);
// The authored graph is the recorded SDK fixture; lifecycle and snapshot below are synthetic.
const published = source
  .replace(
    "<status>draft</status>",
    "<status>published</status><master_snapshot>snapshot1</master_snapshot>",
  )
  .replace(
    "</record_update>",
    `<sys_hub_flow_snapshot action="INSERT_OR_UPDATE"><sys_id>snapshot1</sys_id><flow>${built.head.sysId}</flow></sys_hub_flow_snapshot></record_update>`,
  );

describe("captured update decoding", () => {
  it("verifies a published snapshot alongside the recorded flow's complete authored graph", () => {
    const decoded = decodeCapture(NAME, published);
    expect(decoded?.published).toBe(true);
    expect(decoded !== null && capturedContentAgrees(built, decoded.unit)).toBe(true);
    expect(decodeCapture(NAME, source)?.published).toBe(false);
  });

  it("rejects changed or missing actions, a missing snapshot, and an unrelated snapshot", () => {
    const changed = published.replace(
      "<trigger_type>record_create</trigger_type>",
      "<trigger_type>record_update</trigger_type>",
    );
    // Alter a field that exists in this fixture, even when its display name changes.
    const child = built.children.find((record) => record.sysId !== "");
    if (child === undefined) throw new Error("no fixture action");
    const missing = { ...built, children: built.children.filter((record) => record !== child) };
    expect(capturedContentAgrees(built, missing)).toBe(false);
    expect(
      decodeCapture(NAME, published.replace("<sys_id>snapshot1</sys_id>", "<sys_id>other</sys_id>"))
        ?.published,
    ).toBe(false);
    expect(
      decodeCapture(
        NAME,
        published.replace(/<sys_hub_flow_snapshot[\s\S]*?<\/sys_hub_flow_snapshot>/, ""),
      )?.published,
    ).toBe(false);
    const decoded = decodeCapture(NAME, changed);
    expect(decoded !== null && capturedContentAgrees(built, decoded.unit)).toBe(false);
  });

  it("compares JSON chunks after decompression and key ordering normalization", () => {
    const json = '{"a":1,"b":2}';
    const xml = (value: string) =>
      `<record_update table="sys_json_chunk"><sys_json_chunk action="INSERT_OR_UPDATE"><sys_id>chunk1</sys_id><payload>${value}</payload></sys_json_chunk></record_update>`;
    const wanted = builtUnitOf("sys_json_chunk_chunk1.xml", xml(json));
    const held = decodeCapture(
      wanted.updateName,
      xml(gzipSync('{ "b": 2, "a": 1 }').toString("base64")),
    );
    expect(held !== null && capturedContentAgrees(wanted, held.unit)).toBe(true);
    const wrong = decodeCapture(
      wanted.updateName,
      xml(gzipSync('{"a":2,"b":2}').toString("base64")),
    );
    expect(wrong !== null && capturedContentAgrees(wanted, wrong.unit)).toBe(false);
  });

  it("opens the live JSON chunk too, so capture cannot certify a different live chunk", () => {
    const xml =
      '<record_update table="sys_json_chunk"><sys_json_chunk action="INSERT_OR_UPDATE"><sys_id>chunk1</sys_id><payload>{"a":1}</payload></sys_json_chunk></record_update>';
    const copy = {
      head: { sys_id: "chunk1", payload: gzipSync('{"a":2}').toString("base64") },
      children: [],
      version: "2|now",
      foreignRows: 0,
    };
    expect(decodeCapture("sys_json_chunk_chunk1", xml, copy)?.live?.head["payload"]).toBe(
      '{"a":2}',
    );
  });

  it("requires an action snapshot linked to the action definition", () => {
    const xml = (id: string) =>
      `<record_update table="sys_hub_action_type_definition"><sys_hub_action_type_definition action="INSERT_OR_UPDATE"><sys_id>action1</sys_id><name>Notify</name><state>published</state></sys_hub_action_type_definition><sys_hub_action_type_snapshot action="INSERT_OR_UPDATE"><sys_id>snapshot1</sys_id><action_type>${id}</action_type></sys_hub_action_type_snapshot></record_update>`;
    expect(decodeCapture("action1", xml("action1"))?.published).toBe(true);
    expect(decodeCapture("action1", xml("other"))?.published).toBe(false);
  });

  it("treats malformed, empty and unreadable payloads as missing evidence", () => {
    for (const payload of ["", "<record_update>", "not XML", "<record_update><x/></record_update>"])
      expect(decodeCapture(NAME, payload)).toBeNull();
  });
});
