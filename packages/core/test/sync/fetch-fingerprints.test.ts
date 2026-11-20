import { describe, expect, it } from "bun:test";
import { FINGERPRINT_SOURCES, fetchFingerprints } from "@snagentic/core";
import { fakeInstance } from "../support/fake-instance";

const LIVE = new AbortController().signal;
// The instance's clock when the fingerprints are read.
const NOON = () => Date.parse("2026-10-05T12:00:00Z");

describe("fetchFingerprints", () => {
  it("fingerprints every change source", async () => {
    const instance = fakeInstance({
      sys_ui_element: [{ sys_id: "e1", sys_updated_on: "2026-10-05 09:00:00" }],
    });
    const { fingerprints, unreadable } = await fetchFingerprints(instance.reader, LIVE, NOON);
    expect(Object.keys(fingerprints).sort()).toEqual([...FINGERPRINT_SOURCES].sort());
    expect(fingerprints["sys_ui_element"]).toEqual({
      count: 1,
      maxUpdatedOn: "2026-10-05 09:00:00",
    });
    expect(unreadable).toEqual([]);
  });

  // pdi15, 2026-11-20: two records shipped with sn_na_analytics are dated 2099-01-01, so the
  // latest update of sys_metadata never moved and a record changed in place was not pulled.
  it("reads the latest update without the rows dated in the future", async () => {
    const instance = fakeInstance({
      sys_ui_element: [
        { sys_id: "e1", sys_updated_on: "2026-10-05 09:00:00" },
        { sys_id: "e2", sys_updated_on: "2099-01-01 00:00:00" },
      ],
    });
    const { fingerprints } = await fetchFingerprints(instance.reader, LIVE, NOON);
    expect(fingerprints["sys_ui_element"]).toEqual({
      count: 2,
      maxUpdatedOn: "2026-10-05 09:00:00",
    });
    // One more aggregate request, for that source alone; the clocks may differ by five minutes.
    expect(instance.fingerprints.filter((asked) => asked.startsWith("sys_ui_element"))).toEqual([
      "sys_ui_element",
      "sys_ui_element up to 2026-10-05 12:05:00",
    ]);
    expect(instance.fingerprints).toHaveLength(FINGERPRINT_SOURCES.length + 1);
  });

  it("keeps a latest update the clocks' difference explains", async () => {
    const instance = fakeInstance({
      sys_ui_element: [{ sys_id: "e1", sys_updated_on: "2026-10-05 12:03:00" }],
    });
    const { fingerprints } = await fetchFingerprints(instance.reader, LIVE, NOON);
    expect(fingerprints["sys_ui_element"]?.maxUpdatedOn).toBe("2026-10-05 12:03:00");
    expect(instance.fingerprints).toHaveLength(FINGERPRINT_SOURCES.length);
  });

  it("names the sources the user may not aggregate and carries on", async () => {
    const instance = fakeInstance({}, ["wf_activity", "sys_ui_element"]);
    const { fingerprints, unreadable } = await fetchFingerprints(instance.reader, LIVE, NOON);
    expect(unreadable).toEqual(["sys_ui_element", "wf_activity"]);
    expect(fingerprints["wf_activity"]).toBeUndefined();
  });

  it("stops on any other failure", async () => {
    const failing = {
      fingerprint: async () => {
        throw new Error("network down");
      },
      countBy: async () => new Map(),
      count: async () => 0,
    };
    await expect(fetchFingerprints(failing, LIVE, NOON)).rejects.toThrow("network down");
  });
});
