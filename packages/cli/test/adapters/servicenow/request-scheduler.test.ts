import { describe, expect, it } from "bun:test";
import { ConcurrencyController } from "@snagentic/core";
import type { HttpResponse, Transport } from "../../../src/adapters/servicenow/http-types";
import { RequestScheduler } from "../../../src/adapters/servicenow/request-scheduler";
import { fakeClock, GET, response } from "./scheduler-fakes";

const LIVE = new AbortController().signal;

function sequence(...outcomes: (HttpResponse | Error)[]): Transport & { calls: number } {
  const transport = Object.assign(
    async () => {
      const next = outcomes[Math.min(transport.calls, outcomes.length - 1)];
      transport.calls += 1;
      if (next instanceof Error) {
        throw next;
      }
      return next as HttpResponse;
    },
    { calls: 0 },
  );
  return transport;
}

describe("RequestScheduler", () => {
  it("never runs more requests at once than the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const transport: Transport = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return response(200);
    };
    const scheduler = new RequestScheduler(transport, { clock: fakeClock() });
    await Promise.all(Array.from({ length: 10 }, () => scheduler.send(GET, LIVE)));
    expect(peak).toBe(2);
  });

  it("retries a 503 with back-off and returns the eventual success", async () => {
    const clock = fakeClock();
    const transport = sequence(response(503), response(503), response(200, '{"ok":1}'));
    const result = await new RequestScheduler(transport, { clock }).send(GET, LIVE);
    expect(result.status).toBe(200);
    expect(clock.slept).toEqual([1000, 2000]);
  });

  it("waits as long as Retry-After asks", async () => {
    const clock = fakeClock();
    const transport = sequence(response(429, "{}", { "Retry-After": "7" }), response(200));
    await new RequestScheduler(transport, { clock }).send(GET, LIVE);
    expect(clock.slept).toEqual([7000]);
  });

  it("never retries a write", async () => {
    const transport = sequence(response(503), response(200));
    const result = await new RequestScheduler(transport, { clock: fakeClock() }).send(
      { ...GET, method: "POST" },
      LIVE,
    );
    expect({ status: result.status, calls: transport.calls }).toEqual({ status: 503, calls: 1 });
  });

  it("reports an unreachable instance after the last attempt", async () => {
    const transport = sequence(new TypeError("fetch failed"));
    const scheduler = new RequestScheduler(transport, { clock: fakeClock() });
    await expect(scheduler.send(GET, LIVE)).rejects.toMatchObject({
      code: "instance-unreachable",
      hint: expect.stringContaining("hibernat"),
    });
    expect(transport.calls).toBe(5);
  });

  it("slows down when the instance reports semaphore waits", async () => {
    const controller = new ConcurrencyController({ initial: 4 });
    const transport = sequence(response(200, "{}", { "Server-Timing": "sem_wait;dur=900" }));
    await new RequestScheduler(transport, { clock: fakeClock(), controller }).send(GET, LIVE);
    expect(controller.limit).toBe(2);
  });

  it("stops at the request budget for the run", async () => {
    const scheduler = new RequestScheduler(sequence(response(200)), {
      clock: fakeClock(),
      budget: 2,
    });
    await scheduler.send(GET, LIVE);
    await scheduler.send(GET, LIVE);
    await expect(scheduler.send(GET, LIVE)).rejects.toMatchObject({
      code: "request-budget-exhausted",
    });
  });

  it("cancels a queued request without ever sending it", async () => {
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transport = Object.assign(
      async () => {
        transport.calls += 1;
        await blocked;
        return response(200);
      },
      { calls: 0 },
    );
    const scheduler = new RequestScheduler(transport, {
      clock: fakeClock(),
      controller: new ConcurrencyController({ initial: 1 }),
    });
    const first = scheduler.send(GET, LIVE);
    const cancellation = new AbortController();
    const queued = scheduler.send(GET, cancellation.signal).catch((error: unknown) => error);
    cancellation.abort();
    expect(await queued).toMatchObject({ code: "cancelled" });
    release();
    await first;
    expect(transport.calls).toBe(1);
  });

  it("cancels an in-flight request", async () => {
    let started: () => void = () => {};
    const inFlight = new Promise<void>((resolve) => {
      started = resolve;
    });
    const transport: Transport = (_request, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        started();
      });
    const cancellation = new AbortController();
    const pending = new RequestScheduler(transport, { clock: fakeClock() })
      .send(GET, cancellation.signal)
      .catch((error: unknown) => error);
    await inFlight;
    cancellation.abort();
    expect(await pending).toMatchObject({ code: "cancelled" });
  });

  it("does not send a request cancelled while it waited for a slot", async () => {
    const transport = sequence(response(200));
    const cancellation = new AbortController();
    const pending = new RequestScheduler(transport, { clock: fakeClock() })
      .send(GET, cancellation.signal)
      .catch((error: unknown) => error);
    cancellation.abort();
    expect(await pending).toMatchObject({ code: "cancelled" });
    expect(transport.calls).toBe(0);
  });

  it("stops during the back-off wait when the run is cancelled, without retrying", async () => {
    const cancellation = new AbortController();
    const clock = {
      ...fakeClock(),
      sleep: async () => {
        cancellation.abort();
        throw new DOMException("aborted", "AbortError");
      },
    };
    const transport = sequence(response(503), response(200));
    const pending = new RequestScheduler(transport, { clock })
      .send(GET, cancellation.signal)
      .catch((error: unknown) => error);
    expect(await pending).toMatchObject({ code: "cancelled" });
    expect(transport.calls).toBe(1);
  });

  it("counts requests, retries, semaphore wait and transaction ids", async () => {
    const transport = sequence(
      response(503, "{}", { "X-Transaction-ID": "a1", "Server-Timing": "sem_wait;dur=3" }),
      response(200, "{}", { "X-Transaction-ID": "b2", "Server-Timing": "sem_wait;dur=4" }),
    );
    const scheduler = new RequestScheduler(transport, { clock: fakeClock() });
    await scheduler.send(GET, LIVE);
    expect(scheduler.stats()).toEqual({
      requests: 2,
      retries: 1,
      semaphoreWaitMs: 7,
      transactionIds: ["a1", "b2"],
      concurrencyLimit: 1,
    });
  });
});
