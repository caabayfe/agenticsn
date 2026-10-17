import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SiteOutput } from "@snagentic/core";

// The built site under the workspace's local state (.snagentic/site, git-ignored).
export class FsSiteOutput implements SiteOutput {
  constructor(readonly root: string) {}

  async replace(files: readonly { readonly path: string; readonly content: string }[]) {
    await rm(this.root, { recursive: true, force: true });
    for (const file of files) {
      const target = join(this.root, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content);
    }
  }
}
