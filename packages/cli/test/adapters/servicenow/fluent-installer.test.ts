import { describe, expect, it } from "bun:test";
import {
  type ApiBody,
  ApiFluentInstaller,
} from "../../../src/adapters/servicenow/fluent-installer";

interface Call {
  method: string;
  path: string;
  post: ApiBody | undefined;
}

function fakeApi(answer: unknown) {
  const calls: Call[] = [];
  return {
    calls,
    api: {
      callApi: async (
        method: "GET" | "POST",
        path: string,
        _what: string,
        _s: AbortSignal,
        post?: ApiBody,
      ) => {
        calls.push({ method, path, post });
        return answer;
      },
    },
  };
}

const signal = new AbortController().signal;

describe("Fluent installer (ServiceNow IDE endpoints)", () => {
  it("loads the build's XML as multipart files into the named update set", async () => {
    const { api, calls } = fakeApi({ targetUpdateSetId: "set1" });
    const files = [
      { name: "sys_hub_flow_f1.xml", content: "<record_update/>" },
      { name: "sys_hub_flow_f2.xml", content: "<record_update/>" },
    ];
    await new ApiFluentInstaller(api).load("489da54a", files, "set1", signal);
    const [call] = calls;
    expect(call?.method).toBe("POST");
    expect(call?.path).toBe("/api/fluent/load/489da54a?targetUpdateSetId=set1");
    const boundary = /boundary=(.+)$/.exec(call?.post?.contentType ?? "")?.[1] ?? "";
    expect(call?.post?.contentType).toStartWith("multipart/form-data; boundary=");
    const body = call?.post?.body ?? "";
    expect(body.split(`--${boundary}\r\n`)).toHaveLength(3);
    expect(body).toContain('name="files"; filename="sys_hub_flow_f1.xml"');
    expect(body.endsWith(`--${boundary}--\r\n`)).toBe(true);
  });

  it("refuses a load the instance put in another update set", async () => {
    const { api } = fakeApi({ targetUpdateSetId: "default" });
    await expect(new ApiFluentInstaller(api).load("global", [], "set1", signal)).rejects.toThrow(
      "not the batch's update set set1",
    );
  });

  it("publishes flows and actions in one call, taking a 422 as per-record results", async () => {
    const { api, calls } = fakeApi({
      status: "error",
      results: [
        { sys_id: "f1", status: "success", message: "Published successfully" },
        { sys_id: "f2", status: "error", error_code: "PUBLISH_FAILED", message: "No Trigger" },
      ],
    });
    const results = await new ApiFluentInstaller(api).publish(
      "x_app",
      { flows: ["f1", "f2"], actions: ["a1"] },
      signal,
    );
    expect(results).toEqual([
      { sysId: "f1", published: true, message: "Published successfully" },
      { sysId: "f2", published: false, message: "No Trigger" },
    ]);
    expect(calls[0]?.path).toBe(
      "/api/now/wfa_fluent/activate_flows?sysparm_transaction_scope=x_app",
    );
    expect(calls[0]?.post?.answers).toEqual([422]);
    expect(JSON.parse(calls[0]?.post?.body ?? "")).toEqual({
      flows: [
        { sys_id: "f1", active: "", state: "" },
        { sys_id: "f2", active: "", state: "" },
      ],
      actions: [{ sys_id: "a1", active: "", state: "" }],
    });
  });

  it("refuses an answer without per-record results", async () => {
    const { api } = fakeApi({ status: "error" });
    await expect(
      new ApiFluentInstaller(api).publish("global", { flows: ["f1"], actions: [] }, signal),
    ).rejects.toThrow("without per-flow results");
  });
});
