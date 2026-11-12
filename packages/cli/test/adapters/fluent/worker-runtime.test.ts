import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
const NOT_STARTING = [process.execPath, "-e", "process.exit(3)"];
const MISSING = [join(tmpdir(), "snagentic-no-such-program")];

function project(mode: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "snagentic-worker-test-"));
  writeFileSync(join(dir, "mode.json"), JSON.stringify(mode));
  // A file the worker rewrites, as a transform rewrites the project's sources.
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "existing.txt"), "before");
  return dir;
}

const EXPECTED_ISOLATION: Record<string, string> = {
  darwin: "sandbox-exec",
  win32: "low-integrity",
};

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
      expect(runtime.isolation?.()).toBe(EXPECTED_ISOLATION[process.platform] ?? "none");
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

  it("passes the sandbox's own variables to the worker, on top of the allow-list", async () => {
    const sandbox: Sandbox = (command) => ({
      command,
      isolation: "none",
      environment: { SNAGENTIC_SANDBOX_TEST: "1" },
    });
    const outcome = await fake({ sandbox }).build(project({ mode: "env" }));
    expect(outcome.success && outcome.records).toContain("SNAGENTIC_SANDBOX_TEST");
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

  it("fails when the worker program can't be found", async () => {
    await expect(fake({ command: MISSING }).build(project({ mode: "env" }))).rejects.toThrow(
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
        records: ["refused EPERM", "refused", "written", "written"],
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

describe.if(process.platform === "win32")("the Windows sandbox", () => {
  it("keeps the worker out of folders outside the project, and lets it write its own", async () => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
    const target = mkdtempSync(join(tmpdir(), "snagentic-outside-"));
    try {
      const mode = { mode: "escape", target, url: `http://127.0.0.1:${server.port}/` };
      const dir = project(mode);
      const runtime = fake({ sandbox: osSandbox() });
      const contained = await runtime.build(dir);
      expect(runtime.isolation?.()).toBe("low-integrity");
      const records = contained.success ? contained.records : [];
      // Low integrity stops writes, not the network (ADR-0055: step 2 would).
      expect(records).toEqual([
        expect.stringMatching(/^refused E(PERM|ACCES)$/),
        "reached",
        "written",
        "written",
      ]);
      expect(existsSync(join(target, "escaped.txt"))).toBe(false);
      expect(readFileSync(join(dir, "src", "existing.txt"), "utf8")).toBe("x");
      // The same worker without the sandbox writes there: the check above means something.
      const open = await fake().build(project(mode));
      expect(open.success && open.records[0]).toBe("written");
    } finally {
      server.stop(true);
    }
  });

  it("can't start another program", async () => {
    const outcome = await fake({ sandbox: osSandbox() }).build(project({ mode: "spawn" }));
    expect(outcome.success && outcome.records).toEqual(["refused"]);
    const open = await fake().build(project({ mode: "spawn" }));
    expect(open.success && open.records).toEqual(["started"]);
  });
});
