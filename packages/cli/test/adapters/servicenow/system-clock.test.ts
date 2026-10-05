import { describe, expect, it } from "bun:test";
import { SYSTEM_CLOCK } from "../../../src/adapters/servicenow/http-types";

describe("SYSTEM_CLOCK", () => {
  it("sleeps for roughly the requested time and reports real time and randomness", async () => {
    const before = SYSTEM_CLOCK.now();
    await SYSTEM_CLOCK.sleep(20, new AbortController().signal);
    expect(SYSTEM_CLOCK.now() - before).toBeGreaterThanOrEqual(15);
    const value = SYSTEM_CLOCK.random();
    expect(value >= 0 && value < 1).toBe(true);
  });

  it("stops sleeping as soon as the run is cancelled", async () => {
    const cancellation = new AbortController();
    const sleeping = SYSTEM_CLOCK.sleep(60_000, cancellation.signal).catch(
      (error: unknown) => error,
    );
    cancellation.abort();
    expect(await sleeping).toBeInstanceOf(DOMException);
  });
});
