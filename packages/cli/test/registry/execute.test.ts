import { describe, expect, it } from "bun:test";
import { describeError, executeUseCase, type ProgressEvent } from "../../src/registry/execute";
import { echoUseCase, FAKE_CONTEXT, progressUseCase, waitForCancelUseCase } from "../support/fakes";

describe("executeUseCase run control", () => {
  it("gives the handler a cancellation signal and a progress reporter", async () => {
    const events: ProgressEvent[] = [];
    const controller = new AbortController();
    await executeUseCase(progressUseCase(), { message: "x" }, FAKE_CONTEXT, {
      signal: controller.signal,
      progress: (event) => events.push(event),
    });
    expect(events.map((event) => event.message)).toEqual(["reading catalog", "writing records"]);
  });

  it("works without run control, for callers that need neither", async () => {
    const { output } = await executeUseCase(echoUseCase(), { message: "hi" }, FAKE_CONTEXT);
    expect(output).toEqual({ echoed: "hi" });
  });

  it("ignores progress reports when the caller does not listen", async () => {
    const { output } = await executeUseCase(progressUseCase(), { message: "x" }, FAKE_CONTEXT);
    expect(output).toEqual({ echoed: "done" });
  });

  it("refuses to start when the run is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const run = { signal: controller.signal, progress: () => {} };
    const error = await executeUseCase(echoUseCase(), { message: "hi" }, FAKE_CONTEXT, run).catch(
      (caught: unknown) => caught,
    );
    expect(describeError(error)).toMatchObject({ code: "cancelled", exitCode: 130 });
  });

  it("reports an aborted handler as cancelled, not as an unexpected error", async () => {
    const controller = new AbortController();
    const pending = executeUseCase(
      waitForCancelUseCase(() => controller.abort()),
      { message: "x" },
      FAKE_CONTEXT,
      { signal: controller.signal, progress: () => {} },
    ).catch((caught: unknown) => caught);
    expect(describeError(await pending)).toMatchObject({ code: "cancelled", exitCode: 130 });
  });
});
