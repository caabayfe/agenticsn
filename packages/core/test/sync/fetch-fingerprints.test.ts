import { describe, expect, it } from "bun:test";
import { FINGERPRINT_SOURCES, fetchFingerprints } from "@snagentic/core";
import { fakeInstance } from "../support/fake-instance";

const LIVE = new AbortController().signal;

describe("fetchFingerprints", () => {
  it("fingerprints every change source", async () => {
    const instance = fakeInstance({
      sys_ui_element: [{ sys_id: "e1", sys_updated_on: "2026-10-05 09:00:00" }],
    });
    const { fingerprints, unreadable } = await fetchFingerprints(instance.reader, LIVE);
    expect(Object.keys(fingerprints).sort()).toEqual([...FINGERPRINT_SOURCES].sort());
    expect(fingerprints["sys_ui_element"]).toEqual({
      count: 1,
      maxUpdatedOn: "2026-10-05 09:00:00",
    });
    expect(unreadable).toEqual([]);
  });

  it("names the sources the user may not aggregate and carries on", async () => {
    const instance = fakeInstance({}, ["wf_activity", "sys_ui_element"]);
    const { fingerprints, unreadable } = await fetchFingerprints(instance.reader, LIVE);
    expect(unreadable).toEqual(["sys_ui_element", "wf_activity"]);
    expect(fingerprints["wf_activity"]).toBeUndefined();
  });

  it("stops on any other failure", async () => {
    const failing = {
      fingerprint: async () => {
        throw new Error("network down");
      },
      countBy: async () => new Map(),
    };
    await expect(fetchFingerprints(failing, LIVE)).rejects.toThrow("network down");
  });
});
