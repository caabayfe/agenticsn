import { describe, expect, it } from "bun:test";
import {
  exportedUpdate,
  exportId,
  inRecordedOrder,
  remoteUpdateSet,
  renderUnload,
} from "@snagentic/core";

const SET = {
  sys_id: "a6200859c3670f10c84c3942b40131cd",
  name: "Incident tweaks",
  description: "Adds a VIP flag",
  application: "global",
  release_date: "",
  origin_sys_id: "",
  state: "complete",
  is_default: "false",
};
const APP = { sysId: "global", name: "Global", scope: "global", version: "" };
const STAMP = { at: "2026-10-06 12:00:00", by: "admin" };
const REMOTE_SPEC = [
  "application",
  "application_name",
  "application_scope",
  "application_version",
  "collisions",
  "description",
  "name",
  "parent",
  "remote_sys_id",
  "state",
  "sys_class_name",
  "sys_created_by",
  "sys_created_on",
  "sys_id",
  "sys_mod_count",
  "sys_updated_by",
  "sys_updated_on",
  "update_set",
].map((name) => ({ name, reference: ["application", "parent", "update_set"].includes(name) }));
const UPDATE_SPEC = [
  "action",
  "application",
  "name",
  "payload",
  "remote_update_set",
  "sys_created_by",
  "sys_created_on",
  "sys_id",
  "sys_mod_count",
  "sys_recorded_at",
  "sys_updated_by",
  "sys_updated_on",
  "target_name",
  "type",
  "update_set",
].map((name) => ({
  name,
  reference: ["application", "remote_update_set", "update_set"].includes(name),
}));
const UPDATE = {
  sys_id: "0123456789abcdef0123456789abcdef",
  action: "INSERT_OR_UPDATE",
  application: "global",
  name: "sys_script_c0ffee",
  payload: '<?xml version="1.0" encoding="UTF-8"?><record_update/>',
  sys_created_by: "dev",
  sys_created_on: "2026-10-01 09:00:00",
  sys_mod_count: "3",
  sys_recorded_at: "195ac7b8a4d0000001",
  sys_updated_by: "dev",
  sys_updated_on: "2026-10-02 09:00:00",
  target_name: "VIP flag",
  type: "Business Rule",
  update_set: SET.sys_id,
};

describe("exportId", () => {
  it("derives a stable sys_id-shaped id from the original", () => {
    expect(exportId(SET.sys_id)).toMatch(/^[0-9a-f]{32}$/);
    expect(exportId(SET.sys_id)).toBe(exportId(SET.sys_id));
    expect(exportId(SET.sys_id)).not.toBe(exportId(UPDATE.sys_id));
  });
});

describe("export mapping", () => {
  it("copies the update set into a loaded remote update set, as Export to XML does", () => {
    const xml = renderUnload(STAMP.at, [remoteUpdateSet(REMOTE_SPEC, SET, APP, STAMP)]);
    expect(xml).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<unload unload_date="2026-10-06 12:00:00">',
        '<sys_remote_update_set action="INSERT_OR_UPDATE">',
        '<application display_value="Global">global</application>',
        "<application_name>Global</application_name>",
        "<application_scope>global</application_scope>",
        "<application_version/>",
        "<collisions/>",
        "<description>Adds a VIP flag</description>",
        "<name>Incident tweaks</name>",
        '<parent display_value=""/>',
        `<remote_sys_id>${SET.sys_id}</remote_sys_id>`,
        "<state>loaded</state>",
        "<sys_class_name>sys_remote_update_set</sys_class_name>",
        "<sys_created_by>admin</sys_created_by>",
        "<sys_created_on>2026-10-06 12:00:00</sys_created_on>",
        `<sys_id>${exportId(SET.sys_id)}</sys_id>`,
        "<sys_mod_count>0</sys_mod_count>",
        "<sys_updated_by>admin</sys_updated_by>",
        "<sys_updated_on>2026-10-06 12:00:00</sys_updated_on>",
        '<update_set display_value=""/>',
        "</sys_remote_update_set>",
        "</unload>",
        "",
      ].join("\n"),
    );
  });

  it("copies each update pointing at the remote copy, keeping its payload and recorded order", () => {
    const record = exportedUpdate(UPDATE_SPEC, UPDATE, APP, SET, STAMP);
    const field = (name: string) => record.fields.find((f) => f.name === name);
    expect(field("sys_id")?.value).toBe(exportId(UPDATE.sys_id));
    expect(field("remote_update_set")).toEqual({
      name: "remote_update_set",
      value: exportId(SET.sys_id),
      display: "Incident tweaks",
    });
    expect(field("update_set")).toEqual({ name: "update_set", value: "", display: "" });
    expect(field("payload")?.value).toBe(UPDATE.payload);
    expect(field("sys_recorded_at")?.value).toBe("195ac7b8a4d0000001");
    expect(field("sys_created_by")?.value).toBe("admin");
    expect(field("sys_mod_count")?.value).toBe("0");
    expect(field("application")).toEqual({
      name: "application",
      value: "global",
      display: "Global",
    });
  });

  it("orders updates as they were recorded", () => {
    const later = { ...UPDATE, sys_id: "b", sys_recorded_at: "2" };
    const earlier = { ...UPDATE, sys_id: "a", sys_recorded_at: "1" };
    expect(inRecordedOrder([later, earlier]).map((row) => row["sys_id"])).toEqual(["a", "b"]);
  });
});
