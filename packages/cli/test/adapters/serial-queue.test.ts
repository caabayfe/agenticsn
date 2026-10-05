import { describe, expect, it } from "bun:test";
import { serialQueue } from "../../src/adapters/serial-queue";

describe("SerialQueue", () => {
  it("runs operations one at a time, in call order", async () => {
    const queue = serialQueue();
    const log: string[] = [];
    const step = (name: string, ms: number) =>
      queue.run(async () => {
        log.push(`start ${name}`);
        await Bun.sleep(ms);
        log.push(`end ${name}`);
      });
    await Promise.all([step("a", 10), step("b", 1), step("c", 5)]);
    expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  });

  it("keeps going after a failed operation, and reports the failure to its caller", async () => {
    const queue = serialQueue();
    const failed = queue.run(async () => {
      throw new Error("boom");
    });
    await expect(failed).rejects.toThrow("boom");
    expect(await queue.run(async () => "next")).toBe("next");
  });
});
