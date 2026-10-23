import { describe, expect, it } from "bun:test";
import { SdkRouteRefusedError } from "@snagentic/core";
import {
  allowedExchange,
  type InstanceExchange,
} from "../../../src/adapters/fluent/instance-exchange";

describe("the exchange snagentic answers the SDK worker with (ADR-0044, item 4)", () => {
  const HOST = "https://instance.example.com/";
  const sent: string[] = [];
  const exchange: InstanceExchange = async (request) => {
    sent.push(`${request.method} ${request.url}`);
    return { status: 200, contentType: "application/json", text: "{}" };
  };
  const checked = allowedExchange(HOST, exchange);

  it("sends allowed reads of the instance", async () => {
    await checked({
      method: "GET",
      url: `${HOST}api/now/table/sys_script_include?sysparm_limit=1`,
    });
    expect(sent).toEqual([`GET ${HOST}api/now/table/sys_script_include?sysparm_limit=1`]);
  });

  it("refuses other hosts and routes, and sends nothing", async () => {
    sent.length = 0;
    for (const request of [
      { method: "GET" as const, url: "https://elsewhere.example.com/api/now/table/x" },
      { method: "POST" as const, url: `${HOST}api/now/table/incident`, body: "{}" },
    ]) {
      await expect(checked(request)).rejects.toBeInstanceOf(SdkRouteRefusedError);
    }
    expect(sent).toEqual([]);
  });
});
