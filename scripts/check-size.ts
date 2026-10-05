// File size gate (v1.0 plan, section 6): no product file over 300 lines.
import { join } from "node:path";

export const MAX_PRODUCT_FILE_LINES = 300;
const PRODUCT_FILES = "packages/*/src/**/*.ts";

export interface FileSize {
  readonly path: string;
  readonly lineCount: number;
}

// Counts lines as an editor shows them: a final newline does not start a new line.
export function countLines(text: string): number {
  if (text === "") {
    return 0;
  }
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
}

export function oversizedFiles(files: readonly FileSize[], limit: number): FileSize[] {
  return files
    .filter((file) => file.lineCount > limit)
    .sort((left, right) => right.lineCount - left.lineCount);
}

export async function productFileSizes(root: string): Promise<FileSize[]> {
  const sizes: FileSize[] = [];
  for await (const path of new Bun.Glob(PRODUCT_FILES).scan({ cwd: root })) {
    sizes.push({ path, lineCount: countLines(await Bun.file(join(root, path)).text()) });
  }
  return sizes;
}

if (import.meta.main) {
  const sizes = await productFileSizes(process.cwd());
  const oversized = oversizedFiles(sizes, MAX_PRODUCT_FILE_LINES);
  for (const file of oversized) {
    console.error(`${file.path}: ${file.lineCount} lines (limit ${MAX_PRODUCT_FILE_LINES})`);
  }
  if (sizes.length === 0 || oversized.length > 0) {
    console.error(
      sizes.length === 0 ? "file size check found no product files" : "split these files",
    );
    process.exit(1);
  }
  const largest = oversizedFiles(sizes, 0)[0];
  console.log(
    `file sizes: ${sizes.length} files, largest ${largest?.path} (${largest?.lineCount} lines)`,
  );
}
