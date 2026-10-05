import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { TerminalSecretReader } from "../../../src/adapters/terminal/terminal-secret-reader";

function fakeTerminal(keys: string[]) {
  const input = Object.assign(new EventEmitter(), {
    isTTY: true,
    rawModes: [] as boolean[],
    setRawMode(mode: boolean) {
      input.rawModes.push(mode);
      return input;
    },
    resume() {
      queueMicrotask(() => {
        for (const key of keys) {
          input.emit("data", Buffer.from(key));
        }
      });
      return input;
    },
    pause() {
      return input;
    },
  });
  let written = "";
  const output = {
    write: (text: string) => {
      written += text;
      return true;
    },
  };
  return { input, output, written: () => written };
}

describe("TerminalSecretReader", () => {
  it("reads a piped secret from stdin without its trailing newline", async () => {
    const reader = new TerminalSecretReader(Readable.from(["s3cr", "et\n"]), { write: () => true });
    expect(await reader.read("password: ")).toBe("s3cret");
  });

  it("prompts on a terminal without echoing, and supports backspace", async () => {
    const terminal = fakeTerminal(["ab", "x", "\u007f", "c", "\r"]);
    const reader = new TerminalSecretReader(terminal.input as never, terminal.output);
    expect(await reader.read("password: ")).toBe("abc");
    expect(terminal.written()).toBe("password: \n");
    expect(terminal.input.rawModes).toEqual([true, false]);
  });

  it("stops with a cancellation when the user presses Ctrl-C", async () => {
    const terminal = fakeTerminal(["ab", "\u0003"]);
    const reader = new TerminalSecretReader(terminal.input as never, terminal.output);
    await expect(reader.read("password: ")).rejects.toMatchObject({ code: "cancelled" });
    expect(terminal.input.rawModes).toEqual([true, false]);
  });
});
