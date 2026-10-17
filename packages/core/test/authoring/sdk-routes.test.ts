import { describe, expect, it } from "bun:test";
import { sdkRouteAllowed } from "@snagentic/core";

describe("sdkRouteAllowed (ADR-0032 item 3)", () => {
  it("lets the SDK read tables and use the read-only exports transform calls (S17)", () => {
    expect(sdkRouteAllowed("GET", "/api/now/table/sys_scope")).toBe(true);
    expect(
      sdkRouteAllowed("GET", "/api/now/table/sys_db_object/5ca12d18cd98c8c0b0b49c82f8c2e9a4"),
    ).toBe(true);
    expect(
      sdkRouteAllowed("POST", "/api/sn_glider/fluent_support/table_relationship_exporter"),
    ).toBe(true);
    expect(
      sdkRouteAllowed("POST", "/api/sn_glider/metadata/unload/24585a3c3484e481f8994b3c68c5d588"),
    ).toBe(true);
  });

  it("refuses every write and every other route", () => {
    expect(sdkRouteAllowed("POST", "/api/now/table/sys_script_include")).toBe(false);
    expect(
      sdkRouteAllowed(
        "PATCH",
        "/api/now/table/sys_script_include/123833b4d97d48be8e9ec5ea16f27764",
      ),
    ).toBe(false);
    expect(sdkRouteAllowed("DELETE", "/api/now/table/sys_properties/a")).toBe(false);
    expect(sdkRouteAllowed("POST", "/api/fluent/load/24585a3c3484e481f8994b3c68c5d588")).toBe(
      false,
    );
    expect(sdkRouteAllowed("POST", "/api/sn_glider/metadata/customize-global/x_app")).toBe(false);
    expect(sdkRouteAllowed("GET", "/api/now/ui/user/current_user")).toBe(false);
    expect(sdkRouteAllowed("GET", "/sys_execution_tracker.do")).toBe(false);
  });
});
