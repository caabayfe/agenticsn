import type { ExistingMirrorFile } from "@snagentic/core";
import type { Subprocess } from "bun";
import { childEnvironment } from "../child-environment";
import { fromYamlStrings } from "../yaml/own-style";
import { gitLines } from "./run-git";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class OutputReader {
  private readonly reader: {
    read(): Promise<{ readonly done: boolean; readonly value: Uint8Array | undefined }>;
  };
  private buffered = new Uint8Array();

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  async line(): Promise<string> {
    while (true) {
      const newline = this.buffered.indexOf(10);
      if (newline >= 0) {
        const line = decoder.decode(this.buffered.slice(0, newline));
        this.buffered = this.buffered.slice(newline + 1);
        return line;
      }
      await this.more();
    }
  }

  async bytes(length: number): Promise<Uint8Array> {
    while (this.buffered.length < length) await this.more();
    const value = this.buffered.slice(0, length);
    this.buffered = this.buffered.slice(length);
    return value;
  }

  private async more(): Promise<void> {
    const next = await this.reader.read();
    if (next.done) throw new Error("git cat-file ended before returning a complete blob");
    if (next.value === undefined) throw new Error("git cat-file returned an empty stream chunk");
    const joined = new Uint8Array(this.buffered.length + next.value.length);
    joined.set(this.buffered);
    joined.set(next.value, this.buffered.length);
    this.buffered = joined;
  }
}

class GitBlobReader {
  private readonly output: OutputReader;
  private readonly stderr: Promise<string>;

  constructor(private readonly child: Subprocess<"pipe", "pipe", "pipe">) {
    this.output = new OutputReader(child.stdout);
    this.stderr = new Response(child.stderr).text();
  }

  static start(repository: string): GitBlobReader {
    return new GitBlobReader(
      Bun.spawn(["git", "cat-file", "--batch"], {
        cwd: repository,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: childEnvironment({ GIT_TERMINAL_PROMPT: "0" }),
      }),
    );
  }

  async text(spec: string): Promise<string> {
    this.child.stdin.write(encoder.encode(`${spec}\n`));
    await this.child.stdin.flush();
    const header = await this.output.line();
    const match = /^[0-9a-f]+ blob ([0-9]+)$/.exec(header);
    if (match === null) throw new Error(`git cat-file failed to read a mirror file: ${header}`);
    const size = Number(match[1]);
    const content = await this.output.bytes(size);
    const terminator = await this.output.bytes(1);
    if (terminator[0] !== 10) throw new Error("git cat-file returned a malformed mirror blob");
    return decoder.decode(content);
  }

  async close(): Promise<void> {
    await this.child.stdin.end();
    const code = await this.child.exited;
    if (code !== 0) throw new Error(`git cat-file failed: ${(await this.stderr).trim()}`);
  }
}

// Reads one blob at a time through one cat-file process; memory is bounded by the largest file.
export async function* gitTreeTexts(
  repository: string,
  ref: string,
  root: string,
): AsyncGenerator<{ readonly path: string; readonly text: string }> {
  const blobs = GitBlobReader.start(repository);
  try {
    for await (const path of gitLines(
      ["ls-tree", "-r", "--name-only", ref, "--", root],
      repository,
    )) {
      yield { path, text: await blobs.text(`${ref}:${path}`) };
    }
  } finally {
    await blobs.close();
  }
}

export async function* existingMirrorFiles(
  repository: string,
  ref: string | null,
  root: string,
): AsyncIterable<ExistingMirrorFile> {
  if (ref === null) return;
  for await (const file of gitTreeTexts(repository, ref, root)) {
    const path = file.path.slice(root.length + 1);
    if (path.endsWith(".yaml")) {
      try {
        yield { kind: "document", path, document: fromYamlStrings(file.text) };
      } catch {
        throw new Error(
          "a committed mirror YAML file could not be parsed; run a full pull to rebuild it",
        );
      }
    } else {
      yield { kind: "text", path, text: file.text };
    }
  }
}
