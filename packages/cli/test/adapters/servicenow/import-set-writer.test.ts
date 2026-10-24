import { describe, expect, it } from "bun:test";
import type { ApiBody } from "../../../src/adapters/servicenow/fluent-installer";
import { ImportSetApiWriter } from "../../../src/adapters/servicenow/import-set-writer";

const signal = new AbortController().signal;

function api(answer: unknown) {
  const calls: { path: string; post: ApiBody | undefined }[] = [];
  return {
    calls,
    poster: {
      callApi: async (
        _m: "GET" | "POST",
        path: string,
        _w: string,
        _s: AbortSignal,
        post?: ApiBody,
      ) => {
        calls.push({ path, post });
        return answer;
      },
    },
  };
}

describe("Import Set API writer", () => {
  it("posts one row as JSON to the import set table and reads the transform's status", async () => {
    const { poster, calls } = api([{ transform_map: "Location", status: "updated", sys_id: "s1" }]);
    const result = await new ImportSetApiWriter(poster).post(
      "imp_location",
      { name: "Sydney" },
      signal,
    );
    expect(result).toEqual({ status: "updated", sysId: "s1" });
    expect(calls).toEqual([
      { path: "/api/now/import/imp_location", post: { body: '{"name":"Sydney"}' } },
    ]);
  });

  it("keeps the transform's message for a row it skipped", async () => {
    const message = "Reference field value for service_offering.schedule rejected: 24 x 7";
    const { poster } = api([{ status: "skipped", sys_id: "", status_message: message }]);
    expect(await new ImportSetApiWriter(poster).post("t", {}, signal)).toEqual({
      status: "skipped",
      sysId: "",
      message,
    });
  });

  it("takes an answer without a known status as an error", async () => {
    expect(
      await new ImportSetApiWriter(api([{ status: "odd" }]).poster).post("t", {}, signal),
    ).toEqual({
      status: "error",
      sysId: "",
    });
    expect(await new ImportSetApiWriter(api(undefined).poster).post("t", {}, signal)).toEqual({
      status: "error",
      sysId: "",
    });
  });
});
