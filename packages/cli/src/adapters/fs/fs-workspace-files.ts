import { readFile } from "node:fs/promises";
import type { WorkspaceFiles } from "@snagentic/core";
import { writeTextFile } from "./write-text-file";

export const fsWorkspaceFiles: WorkspaceFiles = {
  read: async (path) => {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  },
  write: writeTextFile,
};
