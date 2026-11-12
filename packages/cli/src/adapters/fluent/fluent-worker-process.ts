import { serveFluentWorker } from "./fluent-worker";
import type { FluentRuntime } from "./sdk-runtime";
import { win32Confinement } from "./win32-calls";
import { confineWorker } from "./windows-confinement";

// On Windows, when snagentic asks for it, the worker confines itself before it loads the SDK or
// reads the project (ADR-0055). If it can't, it exits before `ready`: snagentic then starts it
// again without the sandbox and says so once (ADR-0044, item 6).
export function confineWorkerProcess(): void {
  try {
    confineWorker(process.env, win32Confinement);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(3);
  }
}

// The worker process (ADR-0044): started by snagentic with an IPC channel, it loads the SDK, serves
// one job and waits to be stopped. It exits when snagentic goes away.
export async function runFluentWorker(load: () => Promise<FluentRuntime>): Promise<never> {
  if (process.send === undefined) {
    process.stderr.write("an internal command: snagentic starts it to run the Fluent SDK\n");
    process.exit(2);
  }
  process.on("disconnect", () => process.exit(0));
  confineWorkerProcess();
  await serveFluentWorker(await load(), {
    send: (message) => process.send?.(message),
    onMessage: (listener) => process.on("message", listener),
  });
  return new Promise<never>(() => {});
}
