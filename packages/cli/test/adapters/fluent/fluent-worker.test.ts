import { describe, expect, it } from "bun:test";
import { serveFluentWorker, type WorkerChannel } from "../../../src/adapters/fluent/fluent-worker";
import type { FluentRuntime } from "../../../src/adapters/fluent/sdk-runtime";
import type { FromWorker } from "../../../src/adapters/fluent/worker-protocol";

// The worker's side of ADR-0044, over an in-memory channel.

function channel() {
  const sent: FromWorker[] = [];
  let listener: (message: unknown) => void = () => {};
  const port: WorkerChannel = {
    send: (message) => sent.push(message),
    onMessage: (l) => {
      listener = l;
    },
  };
  return { port, sent, deliver: (message: unknown) => listener(message) };
}

const runtime = (overrides: Partial<FluentRuntime> = {}): FluentRuntime => ({
  sdkVersion: "test",
  build: async () => ({ success: true, records: ["dist/app/a.xml"] }),
  transform: async (_dir, _records, _host, exchange) => {
    const answer = await exchange({ method: "GET", url: "https://i.example.com/api/now/table/x" });
    return { success: true, files: [answer.text] };
  },
  ...overrides,
});

describe("the worker serving one job", () => {
  it("says it is ready, builds, and sends the outcome", async () => {
    const { port, sent, deliver } = channel();
    const served = serveFluentWorker(runtime(), port);
    expect(sent).toEqual([{ kind: "ready" }]);
    deliver({ kind: "build", projectDir: "/p" });
    await served;
    expect(sent.at(-1)).toEqual({
      kind: "built",
      outcome: { success: true, records: ["dist/app/a.xml"] },
    });
  });

  it("sends the SDK's instance requests out and uses the answers", async () => {
    const { port, sent, deliver } = channel();
    const served = serveFluentWorker(runtime(), port);
    deliver({ kind: "transform", projectDir: "/p", records: [], host: "https://i.example.com/" });
    await Bun.sleep(0);
    expect(sent.at(-1)).toEqual({
      kind: "ask",
      id: 0,
      request: { method: "GET", url: "https://i.example.com/api/now/table/x" },
    });
    deliver({
      kind: "answer",
      id: 0,
      answer: { status: 200, contentType: "text/plain", text: "f.ts" },
    });
    await served;
    expect(sent.at(-1)).toEqual({
      kind: "transformed",
      outcome: { success: true, files: ["f.ts"] },
    });
  });

  it("passes a refused request on to the SDK as an error", async () => {
    const { port, sent, deliver } = channel();
    const served = serveFluentWorker(runtime(), port);
    deliver({ kind: "transform", projectDir: "/p", records: [], host: "https://i.example.com/" });
    await Bun.sleep(0);
    deliver({ kind: "answer-failed", id: 0, message: "refused" });
    await served;
    expect(sent.at(-1)).toEqual({ kind: "failed", message: "refused" });
  });

  it("reports an SDK failure, and an unreadable message", async () => {
    const failing = channel();
    const broken = runtime({ build: () => Promise.reject(new Error("the SDK broke")) });
    const served = serveFluentWorker(broken, failing.port);
    failing.deliver({ kind: "build", projectDir: "/p" });
    await served;
    expect(failing.sent.at(-1)).toEqual({ kind: "failed", message: "the SDK broke" });

    const garbled = channel();
    const ended = serveFluentWorker(runtime(), garbled.port);
    garbled.deliver({ kind: "run", script: "anything" });
    await ended;
    expect(garbled.sent.at(-1)).toEqual({ kind: "failed", message: "unreadable message" });
  });

  it("serves one job only, and refuses an answer as a job", async () => {
    const { port, sent, deliver } = channel();
    let builds = 0;
    const counting = runtime({
      build: async () => {
        builds++;
        return { success: true, records: [] };
      },
    });
    const served = serveFluentWorker(counting, port);
    deliver({ kind: "answer", id: 9, answer: { status: 200, contentType: "", text: "" } });
    deliver({ kind: "build", projectDir: "/p" });
    deliver({ kind: "build", projectDir: "/q" });
    await served;
    expect(builds).toBe(1);
    expect(sent.filter((m) => m.kind === "built")).toHaveLength(1);
  });
});
