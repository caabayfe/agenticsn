import type { InstanceExchange } from "./instance-exchange";
import type { FluentRuntime } from "./sdk-runtime";
import { type FromWorker, ToWorker } from "./worker-protocol";

// The worker's side of ADR-0044: runs one build or transform with the SDK loaded in this process,
// and sends the SDK's instance requests to snagentic, which holds the credential.

export interface WorkerChannel {
  send(message: FromWorker): void;
  onMessage(listener: (message: unknown) => void): void;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

interface Pending {
  readonly resolve: (answer: Awaited<ReturnType<InstanceExchange>>) => void;
  readonly reject: (error: Error) => void;
}

// Requests go out as `ask` messages; answers come back by id.
function relayedExchange(channel: WorkerChannel, pending: Map<number, Pending>): InstanceExchange {
  let next = 0;
  return (request) =>
    new Promise((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject });
      channel.send({ kind: "ask", id, request });
    });
}

async function run(
  runtime: FluentRuntime,
  job: ToWorker,
  exchange: InstanceExchange,
): Promise<FromWorker> {
  if (job.kind === "build") {
    return { kind: "built", outcome: await runtime.build(job.projectDir) };
  }
  if (job.kind === "transform") {
    const outcome = await runtime.transform(job.projectDir, job.records, job.host, exchange);
    return { kind: "transformed", outcome };
  }
  return { kind: "failed", message: `expected a job, received ${job.kind}` };
}

// Serves one job and resolves when its result is sent.
export function serveFluentWorker(runtime: FluentRuntime, channel: WorkerChannel): Promise<void> {
  const pending = new Map<number, Pending>();
  const exchange = relayedExchange(channel, pending);
  let started = false;
  return new Promise((done) => {
    const finish = (message: FromWorker) => {
      channel.send(message);
      done();
    };
    channel.onMessage((raw) => {
      const parsed = ToWorker.safeParse(raw);
      if (!parsed.success) return finish({ kind: "failed", message: "unreadable message" });
      const message = parsed.data;
      if (message.kind === "answer" || message.kind === "answer-failed") {
        const waiting = pending.get(message.id);
        pending.delete(message.id);
        if (message.kind === "answer") waiting?.resolve(message.answer);
        else waiting?.reject(new Error(message.message));
        return;
      }
      if (started) return;
      started = true;
      run(runtime, message, exchange).then(finish, (error: unknown) =>
        finish({ kind: "failed", message: messageOf(error) }),
      );
    });
    channel.send({ kind: "ready" });
  });
}
