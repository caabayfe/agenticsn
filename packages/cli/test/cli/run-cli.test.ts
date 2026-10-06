import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { runCli } from "../../src/cli/run-cli";
import { defineUseCase, type UseCase } from "../../src/registry/use-case";
import {
  captureIo,
  echoUseCase,
  FAKE_CONTEXT,
  progressUseCase,
  waitForCancelUseCase,
} from "../support/fakes";

const OPTIONS = { version: "snagentic test", serveMcp: async () => {} };

async function run(argv: string[], useCases: UseCase[] = [echoUseCase()]) {
  const io = captureIo();
  const exitCode = await runCli(argv, useCases, FAKE_CONTEXT, io, OPTIONS);
  return { exitCode, out: io.out(), err: io.err() };
}

describe("generated CLI", () => {
  it("adds a command for a use case with no other code", async () => {
    expect(await run(["echo-text", "--message", "hi"])).toEqual({
      exitCode: 0,
      out: "echo: hi\n",
      err: "",
    });
  });

  it("prints the output as JSON with --format json", async () => {
    const { out } = await run(["echo-text", "--message", "hi", "--format", "json"]);
    expect(JSON.parse(out)).toEqual({ echoed: "hi" });
  });

  it("maps string, number, boolean, enum and optional fields to options", async () => {
    const { out } = await run([
      "echo-text",
      "--message",
      "hi",
      "--times",
      "2",
      "--shout",
      "--style",
      "quoted",
      "--label",
      "x",
    ]);
    expect(out).toBe('echo: "HI" "HI"\n');
  });

  it("offers --no-<flag> for a boolean that defaults to true", async () => {
    const toggle = defineUseCase({
      ...echoUseCase(),
      name: "toggle",
      input: z.object({ local: z.boolean().default(true) }),
      async handle(input) {
        return { echoed: String(input.local) };
      },
    });
    expect((await run(["toggle"], [toggle])).out).toBe("echo: true\n");
    expect((await run(["toggle", "--no-local"], [toggle])).out).toBe("echo: false\n");
  });

  it("takes the use case's listed input fields as positional arguments", async () => {
    const positional = defineUseCase({
      ...echoUseCase(),
      name: "say",
      arguments: ["message", "label"],
    });
    expect((await run(["say", "hi", "--times", "2"], [positional])).out).toBe("echo: hi hi\n");
    expect((await run(["say"], [positional])).exitCode).toBe(2);
  });

  it("turns camelCase input fields into kebab-case options", async () => {
    const dryRun = defineUseCase({
      ...echoUseCase(),
      name: "dry-run",
      input: z.object({ dryRun: z.boolean().default(false) }),
      async handle(input) {
        return { echoed: String(input.dryRun) };
      },
    });
    expect((await run(["dry-run", "--dry-run"], [dryRun])).out).toBe("echo: true\n");
  });

  it("exits with 2 and points to --help when input is invalid", async () => {
    const { exitCode, err } = await run(["echo-text", "--message", "hi", "--times", "0"]);
    expect(exitCode).toBe(2);
    expect(err).toContain("error[invalid-input]");
    expect(err).toContain("hint: run the command with --help");
  });

  it("exits with 2 for an unknown option", async () => {
    expect((await run(["echo-text", "--message", "hi", "--bogus"])).exitCode).toBe(2);
  });

  it("uses the error category's exit code and prints the hint", async () => {
    const { exitCode, err } = await run(["echo-text", "--message", "stale"]);
    expect(exitCode).toBe(3);
    expect(err).toBe("error[stale-mirror]: mirror is stale\nhint: run: snagentic pull\n");
  });

  it("reports errors as JSON on stdout with --format json", async () => {
    const { exitCode, out } = await run(["echo-text", "--message", "stale", "--format", "json"]);
    expect(exitCode).toBe(3);
    expect(JSON.parse(out)).toEqual({
      error: { code: "stale-mirror", message: "mirror is stale", hint: "run: snagentic pull" },
    });
  });

  it("exits with 70 and prints no stack trace for an unexpected error", async () => {
    const { exitCode, err } = await run(["echo-text", "--message", "crash"]);
    expect(exitCode).toBe(70);
    expect(err).toContain("error[unexpected]: internal detail");
    expect(err).not.toContain("    at ");
  });

  it("exits with 0 for --help and --version", async () => {
    expect((await run(["--help"])).exitCode).toBe(0);
    const version = await run(["--version"]);
    expect(version).toMatchObject({ exitCode: 0, out: "snagentic test\n" });
  });

  it("reports progress on stderr and keeps stdout for the result", async () => {
    const { out, err } = await run(
      ["progress-steps", "--message", "x", "--format", "json"],
      [progressUseCase()],
    );
    expect(JSON.parse(out)).toEqual({ echoed: "done" });
    expect(err).toBe("… reading catalog (1/2)\n… writing records (2/2)\n");
  });

  it("exits with 130 when the run is cancelled", async () => {
    const controller = new AbortController();
    const io = captureIo();
    const exitCode = await runCli(
      ["wait-for-cancel", "--message", "x"],
      [waitForCancelUseCase(() => controller.abort())],
      FAKE_CONTEXT,
      io,
      { ...OPTIONS, signal: controller.signal },
    );
    expect(exitCode).toBe(130);
    expect(io.err()).toContain("error[cancelled]");
  });

  it("starts the MCP server for the mcp command", async () => {
    let served = false;
    const io = captureIo();
    const exitCode = await runCli(["mcp"], [], FAKE_CONTEXT, io, {
      ...OPTIONS,
      serveMcp: async () => {
        served = true;
      },
    });
    expect({ exitCode, served }).toEqual({ exitCode: 0, served: true });
  });

  it("maps a list of strings to an option taking several values", async () => {
    let received: unknown;
    const listing = defineUseCase({
      ...echoUseCase(),
      name: "listing",
      input: z.object({ tables: z.array(z.string()).default([]) }),
      async handle(input) {
        received = input.tables;
        return { echoed: "" };
      },
      render: () => "",
    });
    await run(["listing", "--tables", "incident", "task"], [listing]);
    expect(received).toEqual(["incident", "task"]);
  });

  it("takes a list of strings as the last positional argument, absent when none is given", async () => {
    const received: unknown[] = [];
    const listing = defineUseCase({
      ...echoUseCase(),
      name: "listing",
      input: z.object({ paths: z.array(z.string()).optional() }),
      arguments: ["paths"],
      async handle(input) {
        received.push(input.paths);
        return { echoed: "" };
      },
      render: () => "",
    });
    await run(["listing", "a.js", "b.js"], [listing]);
    await run(["listing"], [listing]);
    expect(received).toEqual([["a.js", "b.js"], undefined]);
  });

  it("refuses to generate an option for an input type it cannot map", async () => {
    const unsupported = defineUseCase({
      ...echoUseCase(),
      name: "unsupported",
      input: z.object({ when: z.date() }),
    });
    await expect(run(["unsupported"], [unsupported])).rejects.toThrow(/cannot map/);
  });
});
