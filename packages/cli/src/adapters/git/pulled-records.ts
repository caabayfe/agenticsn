import type { IntegrationOptions, PulledRecord } from "@snagentic/core";
import { childEnvironment } from "../child-environment";
import { fromYamlStrings } from "../yaml/own-style";
import { runGitOrThrow } from "./run-git";

const NEWLINE = 0x0a;
const READING = "integrate: reading changed records for drift";
// A first integrate changes every record (435,638 on a fresh PDI): report every so many.
const PROGRESS_EVERY = 5000;

const lines = (text: string): string[] => text.split("\n").filter(Boolean);

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  const joined = new Uint8Array(a.length + b.length);
  joined.set(a);
  joined.set(b, a.length);
  return joined;
}

// The contents of the given blobs, in order, from one `git cat-file --batch`: one process
// for the whole range instead of one `git show` per file. A missing object yields nothing.
async function* contents(root: string, objects: readonly string[]): AsyncGenerator<string> {
  const child = Bun.spawn(["git", "cat-file", "--batch"], {
    cwd: root,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: childEnvironment({ GIT_TERMINAL_PROMPT: "0" }),
  });
  // Written while the output is read, so neither pipe fills up and blocks the other.
  const writing = (async () => {
    for (const [index, object] of objects.entries()) {
      child.stdin.write(`${object}\n`);
      if (index % 1000 === 999) await child.stdin.flush();
    }
    await child.stdin.end();
  })();
  const decoder = new TextDecoder();
  let buffer: Uint8Array = new Uint8Array(0);
  try {
    for await (const chunk of child.stdout) {
      buffer = concat(buffer, chunk);
      for (;;) {
        const end = buffer.indexOf(NEWLINE);
        if (end < 0) break;
        // "<oid> blob <size>", or "<object> missing".
        const header = decoder.decode(buffer.subarray(0, end)).split(" ");
        if (header[1] !== "blob") {
          buffer = buffer.subarray(end + 1);
          continue;
        }
        const size = Number(header[2]);
        if (buffer.length < end + 1 + size + 1) break;
        yield decoder.decode(buffer.subarray(end + 1, end + 1 + size));
        buffer = buffer.subarray(end + 1 + size + 1);
      }
    }
    await writing;
  } finally {
    child.kill();
  }
}

// The update name and version a record file stamps in its _meta.
function stamps(text: string): PulledRecord | null {
  const document: unknown = fromYamlStrings(text);
  const meta =
    typeof document === "object" && document !== null ? Reflect.get(document, "_meta") : null;
  const field = (name: string) => {
    const value: unknown =
      typeof meta === "object" && meta !== null ? Reflect.get(meta, name) : undefined;
    return typeof value === "string" ? value : "";
  };
  if (field("sys_update_name") === "") return null;
  return {
    updateName: field("sys_update_name"),
    modCount: field("sys_mod_count"),
    updatedOn: field("sys_updated_on"),
  };
}

// The adopted records a range of commits changed in the mirror, with their stamps (ADR-0033
// drift). Nothing is read when nothing is adopted; otherwise only a file that names an adopted
// record is parsed.
export async function pulledRecords(
  root: string,
  range: { readonly from: string; readonly to: string; readonly metadata: string },
  options: IntegrationOptions,
): Promise<PulledRecord[]> {
  const adopted = options.adopted ?? new Set<string>();
  if (adopted.size === 0) return [];
  const { from, to, metadata } = range;
  // ":<mode> <mode> <old blob> <new blob> <status>\t<path>": the new blob is read by id, which
  // git finds directly; "<commit>:<path>" would walk the tree once per file.
  const changed = lines(
    await runGitOrThrow(
      [
        "diff",
        "--raw",
        "--no-abbrev",
        "--no-renames",
        "--diff-filter=AM",
        from,
        to,
        "--",
        metadata,
      ],
      root,
    ),
  )
    .map((line) => {
      const [status = "", path = ""] = line.split("\t");
      return { blob: status.split(" ")[3] ?? "", path };
    })
    .filter(({ path }) => path.endsWith(".yaml") && !path.includes(".children."));
  const names = [...adopted];
  const records: PulledRecord[] = [];
  let read = 0;
  options.progress?.({ message: READING, completed: 0, total: changed.length });
  for await (const text of contents(
    root,
    changed.map(({ blob }) => blob),
  )) {
    read += 1;
    if (read % PROGRESS_EVERY === 0) {
      options.progress?.({ message: READING, completed: read, total: changed.length });
    }
    if (!names.some((name) => text.includes(name))) continue;
    const record = stamps(text);
    if (record !== null && adopted.has(record.updateName)) records.push(record);
  }
  return records;
}
