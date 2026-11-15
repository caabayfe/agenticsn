import { randomUUID } from "node:crypto";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { InvalidInputError, type ManagedAgentFiles } from "@snagentic/core";
import { fsWorkspaceFiles } from "./fs-workspace-files";

async function guard(root: string, path: string): Promise<void> {
  const suffix = relative(root, path);
  if (isAbsolute(suffix) || suffix === ".." || suffix.startsWith(`..${sep}`)) {
    throw new InvalidInputError("agent installation path escapes its destination");
  }
  let current = resolve(root);
  for (const part of ["", ...suffix.split(sep)]) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new InvalidInputError(`agent installation refuses symbolic link: ${current}`);
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
}

export function managedAgentFiles(root: string): ManagedAgentFiles {
  return {
    ...fsWorkspaceFiles,
    guard,
    async read(path) {
      await guard(root, path);
      return fsWorkspaceFiles.read(path);
    },
    async remove(path) {
      await guard(root, path);
      await fsWorkspaceFiles.remove(path);
    },
    async write(path, content) {
      await guard(root, path);
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
        await guard(root, path);
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
    },
  };
}
