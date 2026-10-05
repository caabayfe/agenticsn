import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { InstanceName, MirrorSession, RenderedRecord } from "@snagentic/core";
import { instancePaths } from "@snagentic/core";
import { serialQueue } from "../serial-queue";
import { toYaml } from "../yaml/own-style";
import { FastImport, fastImportPath } from "./fast-import";
import { runGit, runGitOrThrow } from "./run-git";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const IDENTITY = {
  GIT_AUTHOR_NAME: "snagentic",
  GIT_AUTHOR_EMAIL: "snagentic@localhost",
  GIT_COMMITTER_NAME: "snagentic",
  GIT_COMMITTER_EMAIL: "snagentic@localhost",
};

async function revParse(repository: string, ref: string): Promise<string | null> {
  const result = await runGit(["rev-parse", "--verify", "--quiet", ref], repository);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

// A record's YAML is <dir>/<leaf>.yaml where the leaf has no dot (ADR-0017); field files and
// child-row files have more dots.
function recordBaseOf(path: string): string | null {
  const leaf = path.slice(path.lastIndexOf("/") + 1);
  return leaf.endsWith(".yaml") && leaf.split(".").length === 2
    ? path.slice(0, -".yaml".length)
    : null;
}

// Streams a pull into git (spike S8). Progress is committed to refs/snagentic/pull/<name>
// at every checkpoint; finish() commits the final tree on servicenow-remote/<name>.
export class GitMirror implements MirrorSession {
  private readonly pending: string[] = [];
  // Repository paths of record bases (without .yaml) written or resumed: all a pull needs to
  // know about earlier records, far smaller than every file path.
  private readonly recordBases: Set<string>;
  private readonly openedAt = Date.now() - 1000;
  // One fast-import stream is shared by concurrent pull workers: every operation on it runs
  // alone, so blobs and commits are never interleaved.
  private readonly serial = serialQueue();
  // Set once this session has committed: fast-import then continues the ref by itself.
  private committedThisSession = false;

  private constructor(
    private readonly repository: string,
    private readonly instance: InstanceName,
    private readonly stream: FastImport,
    resumedBases: readonly string[],
    private readonly resumedFrom: string | null,
  ) {
    this.recordBases = new Set(resumedBases);
  }

  static async open(
    repository: string,
    instance: InstanceName,
    resume: boolean,
  ): Promise<GitMirror> {
    const ref = GitMirror.progressRef(instance);
    const tip = resume ? await revParse(repository, ref) : null;
    if (!resume) {
      await runGit(["update-ref", "-d", ref], repository);
    }
    const paths =
      tip === null ? "" : await runGitOrThrow(["ls-tree", "-r", "--name-only", tip], repository);
    const bases = paths.split("\n").flatMap((path) => {
      const base = recordBaseOf(path);
      return base === null ? [] : [base];
    });
    return new GitMirror(repository, instance, FastImport.start(repository), bases, tip);
  }

  private static progressRef(instance: InstanceName): string {
    return `refs/snagentic/pull/${instance}`;
  }

  write(root: string, rendered: RenderedRecord): Promise<void> {
    const yaml = toYaml(rendered.document);
    return this.serial.run(async () => {
      await this.add(`${root}/${rendered.base}.yaml`, yaml);
      this.recordBases.add(`${root}/${rendered.base}`);
      for (const file of rendered.files) {
        await this.add(`${root}/${file.path}`, file.content);
      }
    });
  }

  writeDocument(root: string, path: string, document: unknown): Promise<void> {
    const yaml = toYaml(document);
    return this.serial.run(() => this.add(`${root}/${path}`, yaml));
  }

  async *bases(root: string): AsyncIterable<string> {
    const prefix = `${root}/`;
    for (const base of this.recordBases) {
      if (base.startsWith(prefix)) {
        yield base.slice(prefix.length);
      }
    }
  }

  checkpoint(): Promise<void> {
    return this.serial.run(() => this.commitProgress());
  }

  private async commitProgress(): Promise<void> {
    if (this.pending.length === 0) {
      return;
    }
    const ref = GitMirror.progressRef(this.instance);
    await this.stream.command(
      `commit ${ref}\ncommitter snagentic <snagentic@localhost> ${Math.floor(Date.now() / 1000)} +0000\n`,
    );
    await this.stream.data("snagentic pull in progress\n");
    // A fresh pull starts from an empty tree; a resumed one from the durable progress
    // commit. Later commits in the session continue the ref by themselves.
    if (!this.committedThisSession) {
      await this.stream.command(
        this.resumedFrom === null ? "deleteall\n" : `from ${this.resumedFrom}\n`,
      );
    }
    for (const line of this.pending.splice(0)) {
      await this.stream.command(line);
    }
    await this.stream.command("\n");
    this.committedThisSession = true;
    await this.stream.sync();
  }

  async finish(message: string): Promise<string> {
    await this.serial.run(async () => {
      await this.commitProgress();
      await this.stream.finish();
    });
    const ref = GitMirror.progressRef(this.instance);
    const progress = await revParse(this.repository, ref);
    const tree =
      progress === null
        ? EMPTY_TREE
        : (await runGitOrThrow(["rev-parse", `${progress}^{tree}`], this.repository)).trim();
    const branch = `refs/heads/${instancePaths(this.instance).remoteBranch}`;
    const parent = await revParse(this.repository, branch);
    const commit = await this.commitTree(tree, parent, message);
    await runGitOrThrow(["update-ref", branch, commit], this.repository);
    await runGit(["update-ref", "-d", ref], this.repository);
    // One optimized pack; unreachable progress objects are dropped (reflog-reachable objects
    // are kept, so local history is safe). Measured on the PDI: 585 MB -> 230 MB in 11 s.
    await runGitOrThrow(["repack", "-a", "-d", "-q"], this.repository);
    await runGitOrThrow(["prune-packed", "-q"], this.repository);
    return commit;
  }

  async abort(): Promise<void> {
    await this.stream.stop();
    await this.removeTemporaryPacks();
  }

  // Temporary packs fast-import was still writing when stopped. Only files created during
  // this session are removed, never those of another git process.
  private async removeTemporaryPacks(): Promise<void> {
    const directory = join(this.repository, ".git", "objects", "pack");
    for (const name of await readdir(directory).catch(() => [] as string[])) {
      const path = join(directory, name);
      if (name.startsWith("tmp_") && (await stat(path)).mtimeMs >= this.openedAt) {
        await rm(path, { force: true });
      }
    }
  }

  private async add(path: string, content: string): Promise<void> {
    const mark = await this.stream.blob(content);
    this.pending.push(`M 100644 ${mark} ${fastImportPath(path)}\n`);
  }

  private async commitTree(tree: string, parent: string | null, message: string): Promise<string> {
    const args = ["commit-tree", tree, ...(parent === null ? [] : ["-p", parent]), "-m", message];
    const child = Bun.spawn(["git", ...args], {
      cwd: this.repository,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...IDENTITY },
    });
    const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    if (code !== 0) {
      throw new Error(`git commit-tree failed: ${await new Response(child.stderr).text()}`);
    }
    return out.trim();
  }
}
