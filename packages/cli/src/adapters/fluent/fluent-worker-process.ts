import { serveFluentWorker } from "./fluent-worker";
import type { FluentRuntime } from "./sdk-runtime";

// The worker process (ADR-0044): started by snagentic with an IPC channel, it loads the SDK, serves
// one job and waits to be stopped. It exits when snagentic goes away.
export async function runFluentWorker(load: () => Promise<FluentRuntime>): Promise<never> {
  if (process.send === undefined) {
    process.stderr.write("an internal command: snagentic starts it to run the Fluent SDK\n");
    process.exit(2);
  }
  process.on("disconnect", () => process.exit(0));
  await serveFluentWorker(await load(), {
    send: (message) => process.send?.(message),
    onMessage: (listener) => process.on("message", listener),
  });
  return new Promise<never>(() => {});
}
