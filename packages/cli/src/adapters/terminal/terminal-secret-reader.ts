import { OperationCancelledError } from "@snagentic/core";

interface InputStream extends AsyncIterable<unknown> {
  readonly isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  on?(event: "data", listener: (chunk: Buffer) => void): unknown;
  off?(event: "data", listener: (chunk: Buffer) => void): unknown;
  resume?(): unknown;
  pause?(): unknown;
}

interface OutputStream {
  write(text: string): boolean;
}

const ENTER = new Set(["\r", "\n"]);
const BACKSPACE = new Set(["\u007f", "\b"]);
const CTRL_C = "\u0003";

async function readPiped(input: InputStream): Promise<string> {
  let text = "";
  for await (const chunk of input) {
    text += String(chunk);
  }
  return text.replace(/\r?\n$/, "");
}

// Reads a secret: from stdin when piped (CI, scripts), otherwise from a hidden prompt.
// Secrets are never accepted as command-line flags, which end up in shell history.
export class TerminalSecretReader {
  constructor(
    private readonly input: InputStream = process.stdin,
    private readonly output: OutputStream = process.stderr,
  ) {}

  read(prompt: string): Promise<string> {
    return this.input.isTTY === true ? this.prompt(prompt) : readPiped(this.input);
  }

  private prompt(prompt: string): Promise<string> {
    const input = this.input;
    this.output.write(prompt);
    input.setRawMode?.(true);
    return new Promise((resolve, reject) => {
      let secret = "";
      const finish = (outcome: () => void) => {
        input.off?.("data", onData);
        input.setRawMode?.(false);
        input.pause?.();
        this.output.write("\n");
        outcome();
      };
      const onData = (chunk: Buffer) => {
        for (const key of chunk.toString("utf8")) {
          if (ENTER.has(key)) {
            return finish(() => resolve(secret));
          }
          if (key === CTRL_C) {
            return finish(() => reject(new OperationCancelledError()));
          }
          secret = BACKSPACE.has(key) ? secret.slice(0, -1) : secret + key;
        }
      };
      input.on?.("data", onData);
      input.resume?.();
    });
  }
}
