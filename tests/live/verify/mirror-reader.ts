// Reads a mirror branch's files without checking it out: one `git cat-file --batch` process
// answers every read, in order (test plan L0).
import type { Subprocess } from "bun";

export class MirrorReader {
  private readonly process: Subprocess<"pipe", "pipe", "ignore">;
  private readonly reader: { read(): Promise<{ done: boolean; value?: Uint8Array | undefined }> };
  private buffer = new Uint8Array(0);
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly repository: string,
    private readonly ref: string,
  ) {
    this.process = Bun.spawn(["git", "cat-file", "--batch"], {
      cwd: repository,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });
    this.reader = this.process.stdout.getReader();
  }

  // Every file path under `prefix` on the branch.
  async paths(prefix: string): Promise<string[]> {
    const listing = Bun.spawn(["git", "ls-tree", "-r", "--name-only", this.ref, "--", prefix], {
      cwd: this.repository,
      stdout: "pipe",
    });
    return (await new Response(listing.stdout).text()).split("\n").filter(Boolean);
  }

  // The file's text, or null when the branch has no such file. Reads are serialised.
  read(path: string): Promise<string | null> {
    const next = this.queue.then(() => this.readOne(path));
    this.queue = next.catch(() => undefined);
    return next;
  }

  close(): void {
    this.process.stdin.end();
    this.process.kill();
  }

  private async readOne(path: string): Promise<string | null> {
    this.process.stdin.write(`${this.ref}:${path}\n`);
    this.process.stdin.flush();
    const header = new TextDecoder().decode(await this.take(await this.lineLength()));
    await this.take(1);
    const [, type, size] = header.split(" ");
    if (type !== "blob" || size === undefined) return null;
    const body = await this.take(Number(size));
    await this.take(1);
    return new TextDecoder().decode(body);
  }

  private async lineLength(): Promise<number> {
    for (;;) {
      const end = this.buffer.indexOf(10);
      if (end >= 0) return end;
      await this.fill();
    }
  }

  private async take(count: number): Promise<Uint8Array> {
    while (this.buffer.length < count) await this.fill();
    const taken = this.buffer.slice(0, count);
    this.buffer = this.buffer.slice(count);
    return taken;
  }

  private async fill(): Promise<void> {
    const { value, done } = await this.reader.read();
    if (done || value === undefined) throw new Error("git cat-file ended early");
    const joined = new Uint8Array(this.buffer.length + value.length);
    joined.set(this.buffer);
    joined.set(value, this.buffer.length);
    this.buffer = joined;
  }
}
