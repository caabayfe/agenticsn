import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SdkRouteRefusedError } from "@snagentic/core";
import { loadFluentRuntime } from "../../../src/adapters/fluent/fluent-runtime-loader";
import type { InstanceExchange } from "../../../src/adapters/fluent/instance-exchange";
import { type WorkerOptions, workerRuntime } from "../../../src/adapters/fluent/worker-runtime";
import { NO_SANDBOX, osSandbox, type Sandbox } from "../../../src/adapters/fluent/worker-sandbox";
import { copyFixture, FLUENT_FIXTURES } from "../../support/fluent-fixtures";

// ADR-0044: builds and transforms run in a worker process that holds no credential, sandboxed
// where the operating system allows it, and whose requests and answers snagentic checks.

const BUILD_TIMEOUT = 60_000;
const FAKE = [process.execPath, join(import.meta.dir, "../../support/fake-fluent-worker.ts")];
const HOST = "https://instance.example.com/";
const NOT_STARTING = ["/bin/sh", "-c", "exit 3"];

function project(mode: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "snagentic-worker-test-"));
  writeFileSync(join(dir, "mode.json"), JSON.stringify(mode));
  return dir;
}

function fake(overrides: Partial<WorkerOptions> = {}) {
  return workerRuntime({
    sdkVersion: "test",
    command: FAKE,
    sandbox: NO_SANDBOX,
    warn: () => {},
    ...overrides,
  });
}

const refusing: InstanceExchange = () => Promise.reject(new Error("the instance was asked"));

const planted = ["SNAGENTIC_PDI2_PASSWORD", "GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY", "BUN_OPTIONS"];

afterEach(() => {
  for (const name of planted) delete process.env[name];
});

describe("the SDK worker", () => {
  it(
    "builds the project with the SDK, in a worker",
    async () => {
      const runtime = await loadFluentRuntime();
      const outcome = await runtime.build(copyFixture(join(FLUENT_FIXTURES, "server-modules")));
      expect(outcome.success).toBe(true);
      expect(runtime.isolation?.()).toBe(process.platform === "darwin" ? "sandbox-exec" : "none");
    },
    BUILD_TIMEOUT,
  );

  it("holds no credential and no token from snagentic's environment", async () => {
    for (const name of planted) process.env[name] = "planted";
    const outcome = await fake().build(project({ mode: "env" }));
    const seen = outcome.success ? outcome.records : [];
    expect(seen).toContain("PATH");
    expect(seen).toContain("NO_TELEMETRY");
    for (const name of planted) expect(seen).not.toContain(name);
  });

  it("refuses a file the worker names outside the project", async () => {
    await expect(fake().build(project({ mode: "outside" }))).rejects.toMatchObject({
      code: "fluent-worker-failed",
    });
  });

  it("refuses an answer it can't read", async () => {
    await expect(fake().build(project({ mode: "garbage" }))).rejects.toMatchObject({
      code: "fluent-worker-failed",
    });
  });

  it("fails when the worker stops before answering", async () => {
    await expect(fake().build(project({ mode: "crash" }))).rejects.toThrow(/exit 7/);
  });

  it("fails when no worker starts", async () => {
    await expect(fake({ command: NOT_STARTING }).build(project({ mode: "env" }))).rejects.toThrow(
      /did not start/,
    );
  });

  it("runs without the sandbox, saying so once, when the sandbox doesn't start", async () => {
    const warnings: string[] = [];
    const broken: Sandbox = () => ({ command: NOT_STARTING, isolation: "sandbox-exec" });
    const runtime = fake({ sandbox: broken, warn: (line) => warnings.push(line) });
    for (let i = 0; i < 2; i++) {
      expect((await runtime.build(project({ mode: "env" }))).success).toBe(true);
    }
    expect(warnings).toEqual([expect.stringContaining("still with no credential")]);
    expect(runtime.isolation?.()).toBe("none");
  });

  it("refuses a request the worker sends for a route snagentic doesn't allow, and sends nothing", async () => {
    const url = `${HOST}api/now/table/incident`;
    const asked: string[] = [];
    const exchange: InstanceExchange = async (request) => {
      asked.push(request.url);
      return { status: 200, contentType: "application/json", text: "{}" };
    };
    await expect(
      fake().transform(project({ mode: "ask", url }), [], HOST, exchange),
    ).rejects.toBeInstanceOf(SdkRouteRefusedError);
    expect(asked).toEqual([]);
  });

  it("refuses a request the worker sends to another host", async () => {
    const url = "https://elsewhere.example.com/api/now/table/sys_script_include";
    await expect(
      fake().transform(project({ mode: "read", url }), [], HOST, refusing),
    ).rejects.toBeInstanceOf(SdkRouteRefusedError);
  });

  it("answers the worker's allowed reads through snagentic's exchange", async () => {
    const url = `${HOST}api/now/table/sys_script_include?sysparm_limit=1`;
    const exchange: InstanceExchange = async () => ({
      status: 200,
      contentType: "application/json",
      text: "src/answered.now.ts",
    });
    const outcome = await fake().transform(project({ mode: "read", url }), [], HOST, exchange);
    expect(outcome).toEqual({ success: true, files: ["src/answered.now.ts"] });
  });

  it("lets a build ask the instance nothing", async () => {
    const url = `${HOST}api/now/table/sys_script_include`;
    const outcome = await fake().build(project({ mode: "read", url }));
    expect(outcome.success ? [] : outcome.errors.map((e) => e.message)).toEqual([
      "a build doesn't read the instance",
    ]);
  });
});

describe.if(process.platform === "darwin")("the macOS sandbox", () => {
  it("keeps the worker off the network and out of folders outside the project", async () => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
    const target = mkdtempSync(join(tmpdir(), "snagentic-outside-"));
    try {
      const mode = { mode: "escape", target, url: `http://127.0.0.1:${server.port}/` };
      const contained = await fake({ sandbox: osSandbox() }).build(project(mode));
      expect(contained).toEqual({
        success: true,
        records: ["refused EPERM", "refused", "written"],
      });
      expect(existsSync(join(target, "escaped.txt"))).toBe(false);
      // The same worker without the sandbox reaches the server: the check above means something.
      const open = await fake().build(project({ ...mode, target: join(target, "missing") }));
      expect(open.success && open.records[1]).toBe("reached");
    } finally {
      server.stop(true);
    }
  });
});
