// Live contract test for the ServiceNow IDE endpoints flow delivery calls (ADR-0028 as amended,
// item 7): they are not in the public REST reference, so each platform release is checked here.
// Opt-in, against a development instance, with calls that change nothing on it:
//   SNAGENTIC_LIVE_INSTANCE=pdi2 SNAGENTIC_LIVE_WORKSPACE=../spaces/pdi2 bun test tests/live
import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { EnvironmentCredentialStore } from "../../packages/cli/src/adapters/credentials/environment-credential-store";
import { KeychainCredentialStore } from "../../packages/cli/src/adapters/credentials/keychain-credential-store";
import { LayeredCredentialStore } from "../../packages/cli/src/adapters/credentials/layered-credential-store";
import { YamlProfileStore } from "../../packages/cli/src/adapters/profiles/yaml-profile-store";
import { fetchTransport } from "../../packages/cli/src/adapters/servicenow/fetch-transport";
import { RequestScheduler } from "../../packages/cli/src/adapters/servicenow/request-scheduler";
import { ServiceNowClient } from "../../packages/cli/src/adapters/servicenow/servicenow-client";
import {
  ensureDevelopmentInstance,
  getInstance,
  InstanceName,
  resolveSecret,
} from "../../packages/core/src/index";

const INSTANCE = process.env["SNAGENTIC_LIVE_INSTANCE"];
const WORKSPACE = resolve(process.env["SNAGENTIC_LIVE_WORKSPACE"] ?? ".");
const UNKNOWN = "00000000000000000000000000000000";
const signal = new AbortController().signal;

async function connect(): Promise<ServiceNowClient> {
  const profile = await getInstance(
    WORKSPACE,
    InstanceName.parse(INSTANCE ?? ""),
    new YamlProfileStore(),
  );
  ensureDevelopmentInstance(profile, "the Fluent endpoint contract test");
  const credentials = new LayeredCredentialStore(
    new EnvironmentCredentialStore(process.env),
    new KeychainCredentialStore(),
  );
  const secret = await resolveSecret(profile, credentials);
  return new ServiceNowClient(
    profile,
    secret,
    new RequestScheduler(fetchTransport()),
    "snagentic-live-test",
  );
}

describe.skipIf(INSTANCE === undefined)("ServiceNow IDE endpoints (live)", () => {
  it("activate_flows answers per-record results, and none for a sys_id it does not know", async () => {
    const client = await connect();
    expect(
      await client.fluent.publish("global", { flows: [UNKNOWN], actions: [] }, signal),
    ).toEqual([]);
  });

  it("activate_flows refuses empty lists, which push therefore never sends", async () => {
    const client = await connect();
    const path = "/api/now/wfa_fluent/activate_flows?sysparm_transaction_scope=global";
    const post = { body: JSON.stringify({ flows: [], actions: [] }) };
    await expect(client.callApi("POST", path, "flow publish", signal, post)).rejects.toThrow(
      "HTTP 400",
    );
  });

  it("fluent/load names a target update set that does not exist, before loading anything", async () => {
    const client = await connect();
    await expect(client.fluent.load("global", [], UNKNOWN, signal)).rejects.toThrow(
      `No update set exists with id: ${UNKNOWN}`,
    );
  });
});
