import { describe, expect, it } from "bun:test";
import { ConcurrencyController } from "@snagentic/core";

const healthy = { status: 200, semaphoreWaitMs: 0 };

describe("ConcurrencyController (adaptive, ADR-0016)", () => {
  it("starts at 2 concurrent requests", () => {
    expect(new ConcurrencyController().limit).toBe(2);
  });

  it("grows by one after a run of healthy responses, up to 4", () => {
    const controller = new ConcurrencyController({ healthyStreak: 3 });
    for (let index = 0; index < 20; index += 1) {
      controller.observe(healthy);
    }
    expect(controller.limit).toBe(4);
  });

  it("halves when a request times out, as after a 503 (ADR-0053)", () => {
    const controller = new ConcurrencyController({ initial: 4 });
    controller.timedOut();
    expect(controller.limit).toBe(2);
  });

  it("never rises above the ceiling an instance owner set", () => {
    const controller = new ConcurrencyController({ max: 1, healthyStreak: 1 });
    for (let index = 0; index < 5; index += 1) {
      controller.observe(healthy);
    }
    expect(controller.limit).toBe(1);
  });

  it.each([429, 503])("halves after HTTP %p, never below 1", (status) => {
    const controller = new ConcurrencyController({ initial: 4 });
    controller.observe({ status, semaphoreWaitMs: 0 });
    expect(controller.limit).toBe(2);
    controller.observe({ status, semaphoreWaitMs: 0 });
    controller.observe({ status, semaphoreWaitMs: 0 });
    expect(controller.limit).toBe(1);
  });

  it("takes a new ceiling while it runs: lower caps it at once, higher lets it grow again", () => {
    const controller = new ConcurrencyController({ healthyStreak: 1 });
    controller.observe(healthy);
    expect(controller.limit).toBe(3);
    controller.limitTo(1);
    expect(controller.limit).toBe(1);
    controller.observe(healthy);
    expect(controller.limit).toBe(1);
    controller.limitTo(4);
    controller.observe(healthy);
    expect(controller.limit).toBe(2);
  });

  it("halves when the instance reports we waited for a worker semaphore", () => {
    const controller = new ConcurrencyController({ initial: 4 });
    controller.observe({ status: 200, semaphoreWaitMs: 900 });
    expect(controller.limit).toBe(2);
  });

  it("restarts the healthy streak after slowing down", () => {
    const controller = new ConcurrencyController({ initial: 2, healthyStreak: 3 });
    controller.observe(healthy);
    controller.observe(healthy);
    controller.observe({ status: 503, semaphoreWaitMs: 0 });
    controller.observe(healthy);
    controller.observe(healthy);
    expect(controller.limit).toBe(1);
    controller.observe(healthy);
    expect(controller.limit).toBe(2);
  });
});
