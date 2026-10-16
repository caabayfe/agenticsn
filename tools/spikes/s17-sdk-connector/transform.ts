// Spike S17 (G1, ADR-0032): the SDK's transform run in-process, with its instance access through
// snagentic's request scheduler. The SDK gets no credential: its connector's fetch is replaced,
// and every route it asks for is logged and checked against a read allow-list. Not product code.
//   bun transform.ts <workspace> <instance> <project dir> <table> <sys_id> [<table> <sys_id>...]
import { resolve } from "node:path";
import {
  Connector,
  Orchestrator,
  Project,
} from "../../../packages/cli/node_modules/@servicenow/sdk-api";
import {
  NoOpTelemetry,
  NowConfig,
} from "../../../packages/cli/node_modules/@servicenow/sdk-build-core";
import { EnvironmentCredentialStore } from "../../../packages/cli/src/adapters/credentials/environment-credential-store";
import { KeychainCredentialStore } from "../../../packages/cli/src/adapters/credentials/keychain-credential-store";
import { LayeredCredentialStore } from "../../../packages/cli/src/adapters/credentials/layered-credential-store";
import { OverlayFileSystem } from "../../../packages/cli/src/adapters/fluent/overlay-file-system";
import { collectTypeFiles } from "../../../packages/cli/src/adapters/fluent/type-files";
import { YamlProfileStore } from "../../../packages/cli/src/adapters/profiles/yaml-profile-store";
import { authorize } from "../../../packages/cli/src/adapters/servicenow/authorization";
import { fetchTransport } from "../../../packages/cli/src/adapters/servicenow/fetch-transport";
import { RequestScheduler } from "../../../packages/cli/src/adapters/servicenow/request-scheduler";
import type { HttpMethod } from "../../../packages/core/src/index";
import {
  ensureDevelopmentInstance,
  getInstance,
  InstanceName,
  resolveSecret,
} from "../../../packages/core/src/index";

process.env["NO_TELEMETRY"] = "1";
const [workspace = "", instance = "", projectDir = "", ...pairs] = process.argv.slice(2);
const records: { table: string; sysId: string }[] = [];
for (let i = 0; i + 1 < pairs.length; i += 2) {
  records.push({ table: pairs[i] ?? "", sysId: pairs[i + 1] ?? "" });
}

const profile = await getInstance(workspace, InstanceName.parse(instance), new YamlProfileStore());
ensureDevelopmentInstance(profile);
const secret = await resolveSecret(
  profile,
  new LayeredCredentialStore(
    new EnvironmentCredentialStore(process.env),
    new KeychainCredentialStore(),
  ),
);
const sender = authorize(profile, secret, new RequestScheduler(fetchTransport()));
const signal = new AbortController().signal;

// Routes a read may take. POSTs here are read-only exports (they unload XML, they write nothing).
const READ_POSTS = [
  /^\/api\/sn_glider\/fluent_support\/table_relationship_exporter$/,
  /^\/api\/sn_glider\/metadata\/unload\/[0-9a-f]{32}$/,
];
const log: string[] = [];

class SchedulerConnector extends Connector {
  override async fetch(
    path: string,
    init?: RequestInit,
    params?: URLSearchParams,
  ): Promise<Response> {
    const url = new URL(path, profile.url);
    if (params) url.search = params.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const allowed =
      method === "GET" || (method === "POST" && READ_POSTS.some((r) => r.test(url.pathname)));
    log.push(
      `${allowed ? "ok     " : "REFUSED"} ${method} ${url.pathname}${url.search.slice(0, 120)}`,
    );
    if (!allowed)
      throw new Error(`the SDK asked for ${method} ${url.pathname}, which is not a read`);
    const response = await sender.send(
      {
        method: method as HttpMethod,
        url: url.href,
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      },
      signal,
    );
    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  }
}

// The connector only needs the host: fetch never reaches the credential.
const host = { getUrl: () => profile.url } as unknown as ConstructorParameters<typeof Connector>[0];
const connector = new SchedulerConnector(host);

const rootDir = resolve(projectDir);
const typeFiles = collectTypeFiles(resolve(import.meta.dir, "../../../packages/cli/src/adapters"));
const fileSystem = new OverlayFileSystem(rootDir, typeFiles);
const logger = {
  info: console.log,
  warn: console.warn,
  error: console.error,
  debug: () => {},
  success: console.log,
  trace: () => {},
  log: console.log,
};
const config = NowConfig.parseFromDirectory(rootDir, fileSystem, logger);
const project = new Project({
  config,
  fileSystem,
  rootDir,
  logger,
  telemetryClient: new NoOpTelemetry(),
});
const started = Date.now();
const result = await new Orchestrator(project, connector).transform({
  method: "metadata",
  records,
});
console.log(Object.keys(result as object));
console.log(`\n${log.length} requests in ${Date.now() - started} ms`);
for (const line of log) console.log(line);
console.log(JSON.stringify(sender.stats()));
