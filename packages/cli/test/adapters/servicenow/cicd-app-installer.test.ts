import { describe, expect, it } from "bun:test";
import { createProfile, InstanceName } from "@snagentic/core";
import { CicdAppInstaller } from "../../../src/adapters/servicenow/cicd-app-installer";
import type { HttpRequest, Transport } from "../../../src/adapters/servicenow/http-types";
import { RequestScheduler } from "../../../src/adapters/servicenow/request-scheduler";
import { ServiceNowClient } from "../../../src/adapters/servicenow/servicenow-client";
import { fakeClock, response } from "./scheduler-fakes";

const LIVE = new AbortController().signal;
const profile = createProfile({
  name: InstanceName.parse("pdi"),
  url: "dev312411",
  username: "admin",
  kind: "development",
  acknowledgeReadOnly: false,
});

function installerWith(reply: (request: HttpRequest) => ReturnType<Transport>) {
  const sent: HttpRequest[] = [];
  const transport: Transport = async (request) => {
    sent.push(request);
    return reply(request);
  };
  const client = new ServiceNowClient(
    profile,
    "pw",
    new RequestScheduler(transport, { clock: fakeClock() }),
    "snagentic test",
  );
  return { sent, installer: new CicdAppInstaller(client) };
}

const STARTED =
  '{"result":{"links":{"progress":{"id":"b5fae8911bf03051"}},"status":"0","status_label":"Pending","status_message":"","status_detail":"","error":"","percent_complete":0}}';

describe("CicdAppInstaller (spec 011, I3)", () => {
  it("starts an install of one version with one POST, without demo data unless asked", async () => {
    const { installer, sent } = installerWith(async () => response(200, STARTED));
    expect(await installer.install("sn_ztsd", "3.3.3", false, LIVE)).toEqual({
      progressId: "b5fae8911bf03051",
      status: "pending",
      percent: 0,
      message: "",
      error: "",
    });
    const [request] = sent;
    const url = new URL(request?.url ?? "");
    expect([request?.method, url.pathname]).toEqual(["POST", "/api/sn_cicd/app_repo/install"]);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      scope: "sn_ztsd",
      version: "3.3.3",
      load_demo_data: "false",
    });
  });

  it("asks for the application's demo data when told to (ADR-0048)", async () => {
    const { installer, sent } = installerWith(async () => response(200, STARTED));
    await installer.install("sn_dex", "5.3.2", true, LIVE);
    expect(new URL(sent[0]?.url ?? "").searchParams.get("load_demo_data")).toBe("true");
  });

  it("follows the install's progress through the CI/CD progress API", async () => {
    const { installer, sent } = installerWith(async () =>
      response(200, '{"result":{"status":"2","status_message":"Done","percent_complete":100}}'),
    );
    expect(await installer.progress("b5fae8911bf03051", LIVE)).toMatchObject({
      progressId: "b5fae8911bf03051",
      status: "successful",
      percent: 100,
    });
    expect(sent.map((r) => [r.method, new URL(r.url).pathname])).toEqual([
      ["GET", "/api/sn_cicd/progress/b5fae8911bf03051"],
    ]);
  });
});
