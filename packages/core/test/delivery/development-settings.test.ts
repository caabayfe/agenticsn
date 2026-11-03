import { describe, expect, it } from "bun:test";
import { applyDevelopmentSettings, type Row } from "@snagentic/core";
import { fakeInstance } from "../support/fake-instance";

// Settings a development instance needs and test or production must never get (ADR-0047).

const LIVE = new AbortController().signal;
const ATF = { "sn_atf.runner.enabled": "true", "sn_atf.schedule.enabled": "true" };

function instance(values: Record<string, string>, extra: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    sys_user: [{ sys_id: "u1", user_name: "admin" }],
    sys_properties: Object.entries(values).map(([name, value], i) => ({
      sys_id: `p${i}`,
      name,
      value,
      sys_scope: "global",
    })),
    sys_user_preference: [
      { sys_id: "pref1", user: "u1", name: "sys_update_set", value: "mine" },
      { sys_id: "pref2", user: "u1", name: "apps.current_app", value: "x_app" },
    ],
    ...extra,
  };
  const fake = fakeInstance(tables);
  const session = { reader: fake.reader, writer: fake.reader.writer, signal: LIVE };
  return { tables: fake.tables, session };
}

describe("development settings (ADR-0047)", () => {
  it("turns on what is off, in an update set of its own that it sets to ignore", async () => {
    const { tables, session } = instance({
      "sn_atf.runner.enabled": "false",
      "sn_atf.schedule.enabled": "true",
    });
    const result = await applyDevelopmentSettings(session, "admin", ATF);
    expect(result).toEqual({ changed: ["sn_atf.runner.enabled"], missing: [] });
    const value = (name: string) => tables["sys_properties"]?.find((r) => r["name"] === name);
    expect(value("sn_atf.runner.enabled")?.["value"]).toBe("true");
    const set = tables["sys_update_set"]?.find(
      (s) => s["name"] === "snagentic: ATF test execution (development only)",
    );
    expect(set?.["state"]).toBe("ignore");
    const captured = tables["sys_update_xml"]?.filter((x) => x["name"] === "sys_properties_p0");
    expect(captured?.map((x) => x["update_set"])).toEqual([set?.["sys_id"]]);
  });

  it("puts the user's current application and update set back", async () => {
    const { tables, session } = instance({ "sn_atf.runner.enabled": "false" });
    await applyDevelopmentSettings(session, "admin", ATF);
    const preference = (name: string) =>
      tables["sys_user_preference"]?.find((r) => r["name"] === name)?.["value"];
    expect(preference("sys_update_set")).toBe("mine");
    expect(preference("apps.current_app")).toBe("x_app");
  });

  it("writes nothing when every setting is already on, and names those the instance lacks", async () => {
    const { tables, session } = instance({ "sn_atf.runner.enabled": "true" });
    const result = await applyDevelopmentSettings(session, "admin", ATF);
    expect(result).toEqual({ changed: [], missing: ["sn_atf.schedule.enabled"] });
    expect(tables["sys_update_set"] ?? []).toEqual([]);
  });
});
