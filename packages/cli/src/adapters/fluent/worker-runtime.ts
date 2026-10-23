import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { SdkRouteRefusedError, SnagenticError } from "@snagentic/core";
import { allowedExchange, type InstanceExchange } from "./instance-exchange";
import type { FluentRuntime } from "./sdk-runtime";
import { workerEnvironment } from "./worker-environment";
import { FromWorker, type ToWorker } from "./worker-protocol";
import type { Isolation, Sandbox } from "./worker-sandbox";

// snagentic's side of ADR-0044: every build and transform runs in a new worker process that holds
// no credential, sandboxed where the operating system allows it. snagentic answers the worker's
// instance requests itself, after checking them, and checks what the worker sends back.

class FluentWorkerError extends SnagenticError {
  constructor(message: string) {
    super(
      "fluent-worker-failed",
      "precondition",
      message,
      "run snagentic doctor; if the Fluent check fails, reinstall snagentic and report it",
    );
  }
}

export interface WorkerOptions {
  readonly sdkVersion: string;
  // Starts a worker: the binary in its worker mode, or the worker script from source.
  readonly command: readonly string[];
  readonly sandbox: Sandbox;
  readonly warn: (line: string) => void;
}

type Attempt =
  | { readonly started: false; readonly detail: string }
  | { readonly started: true; readonly message: FromWorker };

interface Job {
  readonly message: ToWorker;
  readonly exchange: InstanceExchange;
  readonly refusals: SdkRouteRefusedError[];
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function answer(child: Bun.Subprocess, message: FromWorker, job: Job): void {
  if (message.kind !== "ask") return;
  const { method, url, body } = message.request;
  const send = (reply: ToWorker) => {
    // The worker may already be stopped.
    try {
      child.send(reply);
    } catch {}
  };
  job.exchange(body === undefined ? { method, url } : { method, url, body }).then(
    ({ status, contentType, text }) =>
      send({ kind: "answer", id: message.id, answer: { status, contentType, text } }),
    (error: unknown) => {
      if (error instanceof SdkRouteRefusedError) job.refusals.push(error);
      send({ kind: "answer-failed", id: message.id, message: messageOf(error) });
    },
  );
}

// One worker, from start to its one result. The worker never exits by itself once it has
// answered: it is stopped here, so its result always arrives before its exit.
function attempt(command: readonly string[], scratch: string, job: Job): Promise<Attempt> {
  return new Promise((resolve) => {
    let ready = false;
    let settled = false;
    const settle = (result: Attempt) => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve(result);
    };
    const child = Bun.spawn([...command], {
      cwd: scratch,
      env: workerEnvironment(scratch),
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
      ipc(raw) {
        const parsed = FromWorker.safeParse(raw);
        if (!parsed.success) {
          return settle({ started: true, message: { kind: "failed", message: "unreadable" } });
        }
        const message = parsed.data;
        if (message.kind === "ask") return answer(child, message, job);
        if (message.kind !== "ready") return settle({ started: true, message });
        if (ready) return;
        ready = true;
        child.send(job.message);
      },
    });
    const stderr = new Response(child.stderr).text();
    child.exited.then(async (code) => {
      const detail = `exit ${code}: ${(await stderr).trim().slice(-500)}`;
      settle(
        ready
          ? {
              started: true,
              message: { kind: "failed", message: `the worker stopped (${detail})` },
            }
          : { started: false, detail },
      );
    });
  });
}

// A file the worker names must be in the project: a relative path that never climbs out.
function inProject(paths: readonly string[]): void {
  const outside = paths.find((p) => isAbsolute(p) || p.split(/[\\/]/).includes(".."));
  if (outside !== undefined) {
    throw new FluentWorkerError(
      `the Fluent build worker named a file outside the project: ${outside}`,
    );
  }
}

const NO_READS: InstanceExchange = () =>
  Promise.reject(new Error("a build doesn't read the instance"));

export function workerRuntime(options: WorkerOptions): FluentRuntime {
  let isolation: Isolation | undefined;
  let warned = false;

  async function run(projectDir: string, job: Job): Promise<FromWorker> {
    const scratch = await realpath(await mkdtemp(join(tmpdir(), "snagentic-worker-")));
    try {
      const sandboxed = options.sandbox(options.command, [await realpath(projectDir), scratch]);
      let outcome = await attempt(sandboxed.command, scratch, job);
      isolation = sandboxed.isolation;
      // Before `ready` the worker hasn't seen the project: only the sandbox can have failed.
      if (!outcome.started && sandboxed.isolation !== "none") {
        if (!warned) {
          options.warn(
            `the ${sandboxed.isolation} sandbox did not start the Fluent build worker; it runs without one, still with no credential (${outcome.detail})`,
          );
          warned = true;
        }
        isolation = "none";
        outcome = await attempt(options.command, scratch, job);
      }
      if (!outcome.started) {
        throw new FluentWorkerError(`the Fluent build worker did not start (${outcome.detail})`);
      }
      const [refused] = job.refusals;
      if (refused !== undefined) throw refused;
      if (outcome.message.kind === "failed") throw new FluentWorkerError(outcome.message.message);
      return outcome.message;
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  return {
    sdkVersion: options.sdkVersion,
    isolation: () => isolation,
    async build(projectDir) {
      const message: ToWorker = { kind: "build", projectDir };
      const result = await run(projectDir, { message, exchange: NO_READS, refusals: [] });
      if (result.kind !== "built") throw new FluentWorkerError(`unexpected ${result.kind}`);
      if (result.outcome.success) inProject(result.outcome.records);
      return result.outcome;
    },
    async transform(projectDir, records, host, exchange) {
      const message: ToWorker = { kind: "transform", projectDir, records, host };
      const checked = allowedExchange(host, exchange);
      const result = await run(projectDir, { message, exchange: checked, refusals: [] });
      if (result.kind !== "transformed") throw new FluentWorkerError(`unexpected ${result.kind}`);
      if (result.outcome.success) inProject(result.outcome.files);
      return result.outcome;
    },
  };
}
