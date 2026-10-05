import { describe, expect, it } from "bun:test";
import { summarizeTimings } from "../../scripts/timings";

describe("summarizeTimings (spike measurements)", () => {
  it("reports run count, median, 95th percentile and maximum using nearest rank", () => {
    const samples = Array.from({ length: 20 }, (_, index) => index + 1);
    expect(summarizeTimings(samples)).toEqual({ runs: 20, p50: 10, p95: 19, max: 20 });
  });

  it("does not depend on the order samples were taken in", () => {
    expect(summarizeTimings([30, 10, 20])).toEqual(summarizeTimings([10, 20, 30]));
  });

  it("rounds to a tenth of a millisecond", () => {
    expect(summarizeTimings([1.234, 1.25])).toEqual({ runs: 2, p50: 1.2, p95: 1.3, max: 1.3 });
  });

  it("refuses an empty sample", () => {
    expect(() => summarizeTimings([])).toThrow(/at least one sample/);
  });
});
