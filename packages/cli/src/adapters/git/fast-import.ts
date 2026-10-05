import type { Subprocess } from "bun";

const encoder = new TextEncoder();
const FLUSH_BYTES = 8 * 1024 * 1024;

// A long-running `git fast-import` (spike S8). Commands are streamed to stdin; `sync()` waits
// until git has written everything so far to disk.
export class FastImport {
  private nextMark = 0;
  private nextProgress = 0;
  private unflushed = 0;
  private stdout = "";
  private readonly waiting = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void }
  >();
  private failure: Error | null = null;

  private constructor(private readonly child: Subprocess<"pipe", "pipe", "pipe">) {
    void this.readProgress();
    void this.watchExit();
  }

  static start(repository: string): FastImport {
    const child = Bun.spawn(["git", "fast-import", "--quiet", "--done"], {
      cwd: repository,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return new FastImport(child);
  }

  // Writes a blob and returns its mark (":<n>").
  async blob(content: string): Promise<string> {
    this.nextMark += 1;
    const mark = `:${this.nextMark}`;
    await this.command(`blob\nmark ${mark}\n`);
    await this.data(content);
    return mark;
  }

  async command(text: string): Promise<void> {
    await this.send(encoder.encode(text));
  }

  async data(content: string): Promise<void> {
    const bytes = encoder.encode(content);
    await this.send(encoder.encode(`data ${bytes.length}\n`));
    await this.send(bytes);
    await this.send(encoder.encode("\n"));
  }

  async sync(): Promise<void> {
    this.nextProgress += 1;
    const marker = `progress snagentic-sync-${this.nextProgress}`;
    if (this.failure !== null) {
      throw this.failure;
    }
    const reached = new Promise<void>((resolve, reject) =>
      this.waiting.set(marker, { resolve, reject }),
    );
    await this.command(`checkpoint\n${marker}\n`);
    await this.child.stdin.flush();
    this.unflushed = 0;
    await reached;
  }

  async finish(): Promise<void> {
    await this.command("done\n");
    await this.child.stdin.end();
    const [code, stderr] = await Promise.all([
      this.child.exited,
      new Response(this.child.stderr).text(),
    ]);
    if (code !== 0) {
      throw new Error(`git fast-import failed: ${stderr.trim()}`);
    }
  }

  kill(): void {
    this.child.kill();
  }

  private async send(bytes: Uint8Array): Promise<void> {
    this.child.stdin.write(bytes);
    this.unflushed += bytes.length;
    if (this.unflushed >= FLUSH_BYTES) {
      await this.child.stdin.flush();
      this.unflushed = 0;
    }
  }

  // If git exits early (a malformed stream, a full disk), waiters fail instead of hanging.
  private async watchExit(): Promise<void> {
    const code = await this.child.exited;
    if (code === 0 || this.waiting.size === 0) {
      return;
    }
    const stderr = await new Response(this.child.stderr).text().catch(() => "");
    this.failure = new Error(`git fast-import stopped (exit ${code}): ${stderr.trim()}`);
    for (const waiter of this.waiting.values()) {
      waiter.reject(this.failure);
    }
    this.waiting.clear();
  }

  private async readProgress(): Promise<void> {
    const decoder = new TextDecoder();
    for await (const chunk of this.child.stdout) {
      this.stdout += decoder.decode(chunk);
      let newline = this.stdout.indexOf("\n");
      while (newline >= 0) {
        const line = this.stdout.slice(0, newline);
        this.stdout = this.stdout.slice(newline + 1);
        this.waiting.get(line)?.resolve();
        this.waiting.delete(line);
        newline = this.stdout.indexOf("\n");
      }
    }
  }
}

// fast-import accepts unquoted paths unless they start with a quote or contain a newline.
export function fastImportPath(path: string): string {
  return path.startsWith('"') || path.includes("\n") ? JSON.stringify(path) : path;
}
