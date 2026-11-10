import { describe, expect, it } from "bun:test";
import { ConcurrencyController } from "@snagentic/core";
import {
  type HttpResponse,
  type Transport,
  TransportTimeoutError,
} from "../../../src/adapters/servicenow/http-types";
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

  it("records the highest concurrency reached and the time spent in requests", async () => {
    let now = 0;
    const clock = { ...fakeClock(), now: () => now };
    const transport: Transport = async () => {
      now += 250;
      return response(200);
    };
    const scheduler = new RequestScheduler(transport, {
      clock,
      controller: new ConcurrencyController({ healthyStreak: 1 }),
    });
    for (let index = 0; index < 3; index += 1) {
      await scheduler.send(GET, LIVE);
    }
    expect(scheduler.stats()).toMatchObject({ peakConcurrency: 4, requestMs: 750 });
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
      peakConcurrency: 2,
      requestMs: 0,
      timeouts: 0,
    });
  });
});

// A clock whose sleeps advance its time, so request spacing can be measured.
function steppingClock() {
  let now = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => now,
    random: () => 1,
    sleep: async (ms: number) => {
      slept.push(ms);
      now += ms;
    },
  };
}

describe("RequestScheduler load limits (ADR-0053)", () => {
  it("counts a timeout as pressure and retries a timed-out read only once", async () => {
    const controller = new ConcurrencyController({ initial: 4 });
    const transport = sequence(new TransportTimeoutError(90_000));
    const scheduler = new RequestScheduler(transport, { clock: fakeClock(), controller });
    await expect(scheduler.send(GET, LIVE)).rejects.toMatchObject({ code: "request-timed-out" });
    expect(transport.calls).toBe(2);
    expect(controller.limit).toBe(1);
    expect(scheduler.stats()).toMatchObject({ requests: 2, retries: 1, timeouts: 2 });
  });

  it("leaves a timed-out read to a caller that retries it itself", async () => {
    const transport = sequence(new TransportTimeoutError(90_000), response(200));
    const scheduler = new RequestScheduler(transport, { clock: fakeClock() });
    await expect(scheduler.send({ ...GET, retryTimeout: false }, LIVE)).rejects.toMatchObject({
      code: "request-timed-out",
    });
    expect(transport.calls).toBe(1);
  });

  it("shares one concurrency limit between every run on the instance", async () => {
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
    const runs = [scheduler.run(), scheduler.run(), scheduler.run()];
    await Promise.all(runs.flatMap((run) => Array.from({ length: 4 }, () => run.send(GET, LIVE))));
    expect(peak).toBe(2);
  });

  it("keeps each run's requests and budget apart", async () => {
    const scheduler = new RequestScheduler(sequence(response(200)), { clock: fakeClock() });
    const first = scheduler.run({ budget: 1 });
    const second = scheduler.run({ budget: 1 });
    await first.send(GET, LIVE);
    await expect(first.send(GET, LIVE)).rejects.toMatchObject({
      code: "request-budget-exhausted",
    });
    await second.send(GET, LIVE);
    expect([first.stats().requests, second.stats().requests]).toEqual([1, 1]);
  });

  it("names the variable that raises the budget", async () => {
    const scheduler = new RequestScheduler(sequence(response(200)), { clock: fakeClock() });
    const run = scheduler.run({ budget: 0, budgetVariable: "SNAGENTIC_PDI_REQUEST_BUDGET" });
    await expect(run.send(GET, LIVE)).rejects.toMatchObject({
      hint: expect.stringContaining("SNAGENTIC_PDI_REQUEST_BUDGET"),
    });
  });

  it("spaces request starts to the requests-per-second limit", async () => {
    const clock = steppingClock();
    const scheduler = new RequestScheduler(sequence(response(200)), {
      clock,
      requestsPerSecond: 4,
    });
    for (let index = 0; index < 3; index += 1) {
      await scheduler.send(GET, LIVE);
    }
    expect(clock.slept).toEqual([250, 250]);
  });

  it("never runs more at once than the owner's maximum concurrency", async () => {
    let active = 0;
    let peak = 0;
    const transport: Transport = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return response(200);
    };
    const scheduler = new RequestScheduler(transport, { clock: fakeClock(), maxConcurrency: 1 });
    await Promise.all(Array.from({ length: 5 }, () => scheduler.send(GET, LIVE)));
    expect(peak).toBe(1);
  });
});

// A response whose headers arrive at once and whose body takes `bodyMs`, or fails with `failure`.
function slowBody(bodyMs: number, onBody: () => void, failure?: Error): HttpResponse {
  return {
    status: 200,
    headers: { get: () => null },
    text: async () => {
      await new Promise((resolve) => setTimeout(resolve, bodyMs));
      onBody();
      if (failure !== undefined) {
        throw failure;
      }
      return '{"result":[]}';
    },
  };
}

describe("RequestScheduler body transfer (PERF2-01)", () => {
  it("holds the concurrency slot until the body is read, so slow bodies never exceed the limit", async () => {
    let active = 0;
    let peak = 0;
    const transport: Transport = async () => {
      active += 1;
      peak = Math.max(peak, active);
      return slowBody(20, () => {
        active -= 1;
      });
    };
    const scheduler = new RequestScheduler(transport, { clock: fakeClock(), maxConcurrency: 2 });
    const bodies = await Promise.all(
      Array.from({ length: 8 }, async () => (await scheduler.send(GET, LIVE)).text()),
    );
    expect(peak).toBe(2);
    expect(bodies.every((body) => body === '{"result":[]}')).toBe(true);
  });

  it("counts a timeout while reading the body as pressure, retries the read once, then fails with a timeout", async () => {
    const controller = new ConcurrencyController({ initial: 4 });
    const transport = Object.assign(
      async () => {
        transport.calls += 1;
        return slowBody(1, () => {}, new TransportTimeoutError(90_000));
      },
      { calls: 0 },
    );
    const scheduler = new RequestScheduler(transport, { clock: fakeClock(), controller });
    await expect(scheduler.send(GET, LIVE)).rejects.toMatchObject({ code: "request-timed-out" });
    expect(transport.calls).toBe(2);
    expect(controller.limit).toBe(1);
    expect(scheduler.stats()).toMatchObject({ requests: 2, retries: 1, timeouts: 2 });
  });

  it("never retries a write whose body timed out", async () => {
    const transport = Object.assign(
      async () => {
        transport.calls += 1;
        return slowBody(1, () => {}, new TransportTimeoutError(90_000));
      },
      { calls: 0 },
    );
    const scheduler = new RequestScheduler(transport, { clock: fakeClock() });
    const post = { ...GET, method: "POST" as const, body: "{}" };
    await expect(scheduler.send(post, LIVE)).rejects.toMatchObject({ code: "request-timed-out" });
    expect(transport.calls).toBe(1);
  });

  it("reports a body cut off for another reason as an unreachable instance", async () => {
    const transport: Transport = async () => slowBody(1, () => {}, new TypeError("socket closed"));
    const scheduler = new RequestScheduler(transport, { clock: fakeClock() });
    await expect(scheduler.send(GET, LIVE)).rejects.toMatchObject({ code: "instance-unreachable" });
  });

  it("reports the time of the request itself, from send to body read, without the queue wait", async () => {
    const clock = steppingClock();
    const transport: Transport = async () => {
      await clock.sleep(300);
      const text = async () => {
        await clock.sleep(200);
        return "{}";
      };
      return { ...response(200), text };
    };
    const scheduler = new RequestScheduler(transport, { clock, requestsPerSecond: 1 });
    await scheduler.send(GET, LIVE);
    const second = await scheduler.send(GET, LIVE);
    expect(second.elapsedMs).toBe(500);
    expect(scheduler.stats().requestMs).toBe(1000);
  });
});
