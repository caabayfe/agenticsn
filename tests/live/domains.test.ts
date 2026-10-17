// Live contract test for listing records of other domains (ADR-0030 #9, spec 009 mirror plan
// M4). Read-only. Names one mirrored record outside the session's domain as <class>:<sys_id>:
//   SNAGENTIC_LIVE_INSTANCE=pdi2 SNAGENTIC_LIVE_WORKSPACE=../spaces/pdi2-fluent \
//   SNAGENTIC_LIVE_OTHER_DOMAIN_RECORD=sys_ui_section:0d93f8e4bf364dbbac650f8206023ecb \
//   bun test tests/live/domains.test.ts
import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { EnvironmentCredentialStore } from "../../packages/cli/src/adapters/credentials/environment-credential-store";
import { KeychainCredentialStore } from "../../packages/cli/src/adapters/credentials/keychain-credential-store";
import { LayeredCredentialStore } from "../../packages/cli/src/adapters/credentials/layered-credential-store";
import { YamlProfileStore } from "../../packages/cli/src/adapters/profiles/yaml-profile-store";
import { fetchTransport } from "../../packages/cli/src/adapters/servicenow/fetch-transport";
import { RequestScheduler } from "../../packages/cli/src/adapters/servicenow/request-scheduler";
import { ServiceNowClient } from "../../packages/cli/src/adapters/servicenow/servicenow-client";
import { getInstance, InstanceName, resolveSecret, TableName } from "../../packages/core/src/index";

const INSTANCE = process.env["SNAGENTIC_LIVE_INSTANCE"];
const WORKSPACE = resolve(process.env["SNAGENTIC_LIVE_WORKSPACE"] ?? ".");
const RECORD = process.env["SNAGENTIC_LIVE_OTHER_DOMAIN_RECORD"];
const signal = new AbortController().signal;

async function connect(): Promise<ServiceNowClient> {
  const profile = await getInstance(
    WORKSPACE,
    InstanceName.parse(INSTANCE ?? ""),
    new YamlProfileStore(),
  );
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

const [className = "", sysId = ""] = (RECORD ?? "").split(":");
// A class condition, as a full pull lists, plus the record's sys_id to keep the answer small.
const QUERY = `sys_class_name=${className}^sys_id=${sysId}`;

describe.skipIf(INSTANCE === undefined || RECORD === undefined)("other domains (live)", () => {
  it("lists a record of another domain when the query asks for every domain", async () => {
    const client = await connect();
    const table = TableName.parse(className);
    const query = { table, query: QUERY, fields: ["sys_id", "sys_domain"], limit: 10 };
    const sessionOnly = await client.query(query, signal);
    const everyDomain = await client.query({ ...query, allDomains: true }, signal);
    console.log(
      `session domain: ${sessionOnly.length} row(s); every domain: ${everyDomain.length}`,
    );
    expect(everyDomain.map((row) => row["sys_id"])).toEqual([sysId]);
  });

  it("counts a record of another domain in the aggregates incremental pulls rely on", async () => {
    const client = await connect();
    expect(await client.count(TableName.parse("sys_metadata"), QUERY, signal)).toBe(1);
  });
});
