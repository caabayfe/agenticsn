import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// Creates a new file. "wx" (O_CREAT | O_EXCL) also refuses a symbolic link at the path, so
// nothing outside the named file is ever written.
export async function createTextFile(path: string, content: string): Promise<"created" | "exists"> {
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, content, { encoding: "utf8", flag: "wx" });
    return "created";
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return "exists";
    }
    throw error;
  }
}
