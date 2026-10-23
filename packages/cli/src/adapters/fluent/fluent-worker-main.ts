// The SDK worker run from source (tests and development); the release binary runs the same
// worker through its hidden command (main.ts).
import { loadInProcessRuntime } from "./fluent-runtime-loader";
import { runFluentWorker } from "./fluent-worker-process";

await runFluentWorker(loadInProcessRuntime);
