import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SdkRouteRefusedError } from "@snagentic/core";
import { loadFluentRuntime } from "../../../src/adapters/fluent/fluent-runtime-loader";
import {
  type InstanceExchange,
  SchedulerConnector,
} from "../../../src/adapters/fluent/scheduler-connector";
import { SDK_BUILD_TIMEOUT } from "../../support/sdk-contract";

// ADR-0032: the embedded SDK's transform, with its requests answered from a recording of pdi2
// (spike S17). Fails when an SDK upgrade asks the instance something else.
const RECORDING = join(
  import.meta.dir,
  "../../../../../tests/fixtures/fluent/transform/script-include-pdi2.json",
);

interface Exchange {
  readonly request: { readonly method: string; readonly url: string; readonly body?: string };
  readonly answer: { readonly status: number; readonly contentType: string; readonly text: string };
}

const recording: { records: { table: string; sysId: string }[]; exchanges: Exchange[] } =
  JSON.parse(readFileSync(RECORDING, "utf8"));

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "snagentic-transform-"));
  const config = {
    scope: "x_2222332_s11",
    scopeId: "489da54ae67c4a3e9f1e1e4347e9119b",
    name: "s11",
    type: "configuration",
  };
  writeFileSync(join(dir, "now.config.json"), JSON.stringify(config));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "s11", version: "0.0.1" }));
  return dir;
}

describe("transform through snagentic's connector (ADR-0032)", () => {
  it(
    "converts a script include with the one read the recording holds",
    async () => {
      const asked: Exchange["request"][] = [];
      const replay: InstanceExchange = async (request) => {
        const url = new URL(request.url);
        const seen = {
          method: request.method,
          url: url.pathname + url.search,
          ...(request.body ? { body: request.body } : {}),
        };
        asked.push(seen);
        const match = recording.exchanges.find(
          (e) =>
            e.request.method === seen.method &&
            e.request.url === seen.url &&
            e.request.body === seen.body,
        );
        if (match === undefined) throw new Error(`not in the recording: ${JSON.stringify(seen)}`);
        return match.answer;
      };
      const dir = project();
      const runtime = await loadFluentRuntime();
      const outcome = await runtime.transform(
        dir,
        recording.records,
        "https://instance.example.com/",
        replay,
      );
      expect(asked).toEqual(recording.exchanges.map((e) => e.request));
      expect(outcome.success).toBe(true);
      const files = outcome.success ? outcome.files : [];
      const source = files.find((f) => f.endsWith(".now.ts")) ?? "";
      expect(readFileSync(join(dir, source), "utf8")).toContain(
        "description: 'Helpers for the E2E probe (edited on the instance).'",
      );
      expect(files.some((f) => f.endsWith(".server.js"))).toBe(true);
    },
    SDK_BUILD_TIMEOUT,
  );
});

describe("SchedulerConnector", () => {
  const answer = { status: 200, contentType: "application/json", text: '{"result":[]}' };

  it("sends an allowed read through the exchange, and answers what came back", async () => {
    const sent: unknown[] = [];
    const connector = new SchedulerConnector("https://instance.example.com/", async (request) => {
      sent.push(request);
      return answer;
    });
    const response = await connector.fetch(
      "/api/now/table/sys_scope",
      undefined,
      new URLSearchParams({ sysparm_limit: "1" }),
    );
    expect(await response.json()).toEqual({ result: [] });
    expect(sent).toEqual([
      {
        method: "GET",
        url: "https://instance.example.com/api/now/table/sys_scope?sysparm_limit=1",
      },
    ]);
  });

  it("refuses a write before anything is sent", async () => {
    const sent: unknown[] = [];
    const connector = new SchedulerConnector("https://instance.example.com/", async (request) => {
      sent.push(request);
      return answer;
    });
    const write = connector.fetch("/api/now/table/sys_script_include", {
      method: "POST",
      body: "{}",
    });
    await expect(write).rejects.toBeInstanceOf(SdkRouteRefusedError);
    await expect(
      connector.fetch("/api/fluent/load/489da54ae67c4a3e9f1e1e4347e9119b", { method: "POST" }),
    ).rejects.toBeInstanceOf(SdkRouteRefusedError);
    expect(sent).toEqual([]);
  });
});
