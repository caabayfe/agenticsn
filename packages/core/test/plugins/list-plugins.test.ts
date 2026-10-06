import { describe, expect, it } from "bun:test";
import { listPlugins, type Row, type SyncStateStore } from "@snagentic/core";

const FILES: Record<string, Row[]> = {
  plugins: [
    {
      id: "com.snc.incident_ai",
      name: "Incident AI",
      active: "active",
      version: "2.0",
      scope: "global",
    },
    {
      id: "com.glide.hub",
      name: "Flow Designer",
      active: "inactive",
      version: "1.0",
      scope: "global",
    },
  ],
  store_apps: [
    {
      scope: "sn_vsc",
      name: "Vulnerability",
      version: "29.0",
      active: "true",
      vendor: "ServiceNow",
    },
    {
      scope: "x_acme_app",
      name: "Acme Incident Bot",
      version: "1.2",
      active: "false",
      vendor: "Acme",
    },
  ],
};
const reader = (files: Record<string, Row[]> = FILES) => ({
  read: async (_root: string, _instance: string, file: string) => files[file] ?? null,
});
const state = (watermark: string | null): SyncStateStore => ({
  readCatalog: async () => null,
  writeCatalog: async () => {},
  readCheckpoint: async () => null,
  writeCheckpoint: async () => {},
  clearCheckpoint: async () => {},
  readState: async () => (watermark === null ? null : { watermark, lastFullPull: watermark }),
  writeState: async () => {},
});

describe("listPlugins", () => {
  it("lists plugins and store apps from the mirrored inventory, with its age", async () => {
    const inventory = await listPlugins(reader(), state("2026-10-06 10:00:00"), "/w", "pdi", {});
    expect(inventory?.plugins.map((p) => [p.id, p.active])).toEqual([
      ["com.snc.incident_ai", true],
      ["com.glide.hub", false],
    ]);
    expect(inventory?.storeApps.map((a) => [a.scope, a.active])).toEqual([
      ["sn_vsc", true],
      ["x_acme_app", false],
    ]);
    expect(inventory?.asOf).toBe("2026-10-06 10:00:00");
  });

  it("filters by text in id, scope or name, ignoring case, and by state", async () => {
    const found = await listPlugins(reader(), state(null), "/w", "pdi", { text: "INCIDENT" });
    expect(found?.plugins.map((p) => p.id)).toEqual(["com.snc.incident_ai"]);
    expect(found?.storeApps.map((a) => a.scope)).toEqual(["x_acme_app"]);
    const inactive = await listPlugins(reader(), state(null), "/w", "pdi", { state: "inactive" });
    expect(inactive?.plugins.map((p) => p.id)).toEqual(["com.glide.hub"]);
    expect(inactive?.storeApps.map((a) => a.scope)).toEqual(["x_acme_app"]);
    const active = await listPlugins(reader(), state(null), "/w", "pdi", { state: "active" });
    expect(active?.plugins.map((p) => p.id)).toEqual(["com.snc.incident_ai"]);
  });

  it("tells when the inventory was never pulled", async () => {
    expect(await listPlugins(reader({}), state(null), "/w", "pdi", {})).toBeNull();
  });
});
