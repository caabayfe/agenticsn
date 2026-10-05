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

  it.each([429, 503])("halves after HTTP %p, never below 1", (status) => {
    const controller = new ConcurrencyController({ initial: 4 });
    controller.observe({ status, semaphoreWaitMs: 0 });
    expect(controller.limit).toBe(2);
    controller.observe({ status, semaphoreWaitMs: 0 });
    controller.observe({ status, semaphoreWaitMs: 0 });
    expect(controller.limit).toBe(1);
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
