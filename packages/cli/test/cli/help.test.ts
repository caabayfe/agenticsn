import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { runCli } from "../../src/cli/run-cli";
import { USE_CASES } from "../../src/registry/registry";
import { defineUseCase, qualifiedName, type UseCase } from "../../src/registry/use-case";
import { captureIo, echoUseCase, FAKE_CONTEXT } from "../support/fakes";

const OPTIONS = { version: "test", serveMcp: async () => {} };

async function run(argv: readonly string[], cases: readonly UseCase[] = USE_CASES) {
  const io = captureIo();
  const exitCode = await runCli(argv, cases, FAKE_CONTEXT, io, OPTIONS);
  return { exitCode, out: io.out(), err: io.err() };
}

describe("task-oriented CLI help (ASR-01, ASR-10)", () => {
  it("fits the everyday commands into 50 lines at 80 columns", async () => {
    const { exitCode, out } = await run(["--help"]);
    expect(exitCode).toBe(0);
    expect(out.trimEnd().split("\n").length).toBeLessThanOrEqual(50);
    expect(
      Math.max(
        ...out
          .trimEnd()
          .split("\n")
          .map((line) => line.length),
      ),
    ).toBeLessThanOrEqual(80);
    for (const section of [
      "Get started:",
      "Understand:",
      "Develop:",
      "Manage:",
      "Additional workflows:",
    ]) {
      expect(out).toContain(section);
    }
    expect(out).toContain("onboard <name>");
    expect(out).toContain("--help-all");
    expect(out).not.toContain("confirm=true");
    expect(out).not.toContain("[options] <instance>");
    expect(out.indexOf("Get started:")).toBeLessThan(out.indexOf("Understand:"));
    expect(out.indexOf("Understand:")).toBeLessThan(out.indexOf("Develop:"));
    expect(out.indexOf("Develop:")).toBeLessThan(out.indexOf("Manage:"));
    expect(out.indexOf("onboard <name>")).toBeLessThan(out.indexOf("  agent "));
    expect(out.indexOf("pull <instance>")).toBeLessThan(out.indexOf("adopt <records...>"));
    expect(out.indexOf("adopt <records...>")).toBeLessThan(out.indexOf("validate [paths...]"));
  });

  it("keeps advanced and host commands discoverable without crowding default help", async () => {
    const normal = await run(["--help"]);
    const all = await run(["--help-all"]);
    expect(all).toMatchObject({ exitCode: 0, err: "" });
    expect(all.out).toContain("Advanced:");
    expect(all.out).toContain("Internal:");
    for (const name of ["init", "take-over", "mcp", "hook", "check", "fluent-keys"]) {
      expect(normal.out).not.toMatch(new RegExp(`^  ${name}(?: |$)`, "m"));
      expect(all.out).toMatch(new RegExp(`^  ${name}(?: |$)`, "m"));
      expect((await run([name, "--help"])).exitCode).toBe(0);
    }
  });

  it("preserves the help command and nested command help", async () => {
    expect((await run(["help", "take-over"])).out).toContain("Usage: snagentic take-over");
    expect((await run(["accelerator", "help", "install"])).out).toContain("--confirm");
    expect((await run(["help"])).out).toBe((await run(["--help"])).out);
  });

  it("still executes a command hidden from default help", async () => {
    const internal = defineUseCase({
      ...echoUseCase(),
      help: {
        summary: "Echo a message",
        section: "Internal",
        visibility: "internal",
        details: "Repeat a message locally.",
        effects: "No external effects.",
        examples: [["echo-text", "--message", "hello"]],
      },
    });
    expect(await run(["echo-text", "--message", "hello"], [internal])).toEqual({
      exitCode: 0,
      out: "echo: hello\n",
      err: "",
    });
  });

  it("uses registry summaries and human details without changing model descriptions", async () => {
    const modelDescription = "Model instructions: do the task, then follow the next tool.";
    const useCase = defineUseCase({
      ...echoUseCase(),
      description: modelDescription,
      help: {
        summary: "Echo a message",
        section: "Understand",
        details: "Repeat the supplied message locally.",
        effects: "Reads no instance and writes no files.",
        examples: [["echo-text", "--message", "hello world"]],
      },
    });
    expect((await run(["--help"], [useCase])).out).toContain("Echo a message");
    const detail = await run(["echo-text", "--help"], [useCase]);
    expect(detail.out).toContain("Repeat the supplied message locally.");
    expect(detail.out).toContain("Effects:");
    expect(detail.out).toContain('snagentic echo-text --message "hello world"');
    expect(detail.out).not.toContain(modelDescription);
    expect(useCase.description).toBe(modelDescription);
  });

  it("shows required flags and defaults without changing input validation", async () => {
    const push = await run(["push", "--help"]);
    expect(push.out).toContain("Required:");
    expect(push.out).toContain("--instance <instance>");
    expect(push.out).toContain("--plan <plan>");
    expect(push.out).toContain("the user approved");
    expect(push.out).not.toContain("plan_push");
    expect(push.out).not.toContain("draftPr");
    expect(push.out).not.toContain("confirm=true");
    const find = await run(["find", "--help"]);
    expect(find.out).toContain("default: 20");
    expect(find.out).toContain("range: 1–100");
    expect((await run(["validate", "--help"])).out).toContain('default: "HEAD"');
    expect((await run(["echo-text"], [echoUseCase()])).err).toContain("error[invalid-input]");
  });

  it("explains groups and does not advertise internal flags as task inputs", async () => {
    for (const group of [
      "instance",
      "auth",
      "agent",
      "update-sets",
      "docs",
      "accelerator",
      "plugins",
      "apps",
    ]) {
      const { out } = await run([group, "--help"]);
      expect(out).not.toContain(`${group} commands`);
      expect(out).not.toContain("--help-all");
    }
  });

  it("documents every CLI command and every flag without invoking a handler", async () => {
    for (const useCase of USE_CASES.filter((u) => u.cli !== false)) {
      expect(useCase.help, qualifiedName(useCase)).toBeDefined();
      const { exitCode, out, err } = await run([...qualifiedName(useCase).split(" "), "--help"]);
      expect({ exitCode, err }).toEqual({ exitCode: 0, err: "" });
      expect(out).toContain("Effects:");
      expect(out).toContain("Examples:");
      expect(out).not.toMatch(/^\s+--[\w-]+(?: <[^>]+>)?\s*$/m);
    }
  });

  it("offers examples accepted by the actual command syntax and input schemas", async () => {
    // Only parsing is under test: replace all effects with a local acknowledgement.
    const syntaxOnly = USE_CASES.map((useCase) => ({
      ...useCase,
      output: z.object({ accepted: z.literal(true) }),
      flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
      handle: async () => ({ accepted: true }),
      render: () => "accepted",
      exitCode: () => 0,
    }));
    for (const useCase of USE_CASES.filter((u) => u.cli !== false)) {
      expect(useCase.help?.examples.length, qualifiedName(useCase)).toBeGreaterThan(0);
      for (const example of useCase.help?.examples ?? []) {
        const result = await run(example, syntaxOnly);
        expect(result, example.join(" ")).toEqual({ exitCode: 0, out: "accepted\n", err: "" });
      }
    }
  });
});
