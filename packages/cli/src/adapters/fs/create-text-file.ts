import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const code = (error: unknown): unknown =>
  error instanceof Error && "code" in error ? error.code : undefined;

// Whether anything is at `path`, a symbolic link included, without following it.
async function occupied(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (code(error) === "ENOENT") return false;
    throw error;
  }
}

// Creates a new file. "wx" (O_CREAT | O_EXCL) also refuses a symbolic link at the path on POSIX;
// Windows has no O_NOFOLLOW, and "wx" through a dangling link creates its target, so a link is
// looked for first. Nothing outside the named file is ever written.
export async function createTextFile(path: string, content: string): Promise<"created" | "exists"> {
  await mkdir(dirname(path), { recursive: true });
  if (await occupied(path)) return "exists";
  try {
    await writeFile(path, content, { encoding: "utf8", flag: "wx" });
    return "created";
  } catch (error) {
    if (code(error) === "EEXIST") return "exists";
    throw error;
  }
}
