import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  FinishedPull,
  IncrementalMirror,
  InstanceName,
  MirrorMode,
  RenderedRecord,
} from "@snagentic/core";
import { instancePaths } from "@snagentic/core";
import { serialQueue } from "../serial-queue";
import { toYaml } from "../yaml/own-style";
import { FastImport, fastImportPath } from "./fast-import";
import { MirrorIndex } from "./mirror-index";
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

// Streams a pull into git (spike S8). Progress is committed to refs/snagentic/pull/<name>
// at every checkpoint; finish() commits the final tree on servicenow-remote/<name>.
// A fresh pull starts from an empty tree, a resumed one from its last progress commit, and an
// incremental one from the remote branch, changing only what changed on the instance.
export class GitMirror implements IncrementalMirror {
  private readonly pending: string[] = [];
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
    private readonly index: MirrorIndex,
    private readonly startFrom: string | null,
    private readonly mode: MirrorMode,
  ) {}

  static async open(
    repository: string,
    instance: InstanceName,
    mode: MirrorMode,
  ): Promise<GitMirror> {
    const progress = GitMirror.progressRef(instance);
    const start = await GitMirror.startOf(repository, instance, mode);
    if (mode !== "resume") {
      await runGit(["update-ref", "-d", progress], repository);
    }
    const paths =
      start === null
        ? ""
        : await runGitOrThrow(["ls-tree", "-r", "--name-only", start], repository);
    const index = MirrorIndex.fromPaths(paths.split("\n"));
    return new GitMirror(repository, instance, FastImport.start(repository), index, start, mode);
  }

  private static async startOf(
    repository: string,
    instance: InstanceName,
    mode: MirrorMode,
  ): Promise<string | null> {
    if (mode === "fresh") {
      return null;
    }
    if (mode === "resume") {
      return revParse(repository, GitMirror.progressRef(instance));
    }
    const tip = await revParse(repository, GitMirror.remoteBranch(instance));
    if (tip === null) {
      throw new Error(`no ${instancePaths(instance).remoteBranch} branch to continue from`);
    }
    return tip;
  }

  private static remoteBranch(instance: InstanceName): string {
    return `refs/heads/${instancePaths(instance).remoteBranch}`;
  }

  private static progressRef(instance: InstanceName): string {
    return `refs/snagentic/pull/${instance}`;
  }

  write(root: string, rendered: RenderedRecord): Promise<void> {
    const yaml = toYaml(rendered.document);
    return this.serial.run(async () => {
      await this.add(`${root}/${rendered.base}.yaml`, yaml);
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
    yield* this.index.bases(`${root}/`);
  }

  baseOf(root: string, sysId: string): string | undefined {
    const base = this.index.baseOf(sysId);
    return base?.startsWith(`${root}/`) ? base.slice(root.length + 1) : undefined;
  }

  filesOf(root: string, base: string): string[] {
    return this.index.filesOf(`${root}/${base}`).map((path) => path.slice(root.length + 1));
  }

  remove(root: string, path: string): Promise<void> {
    return this.serial.run(async () => {
      this.pending.push(`D ${fastImportPath(`${root}/${path}`)}\n`);
      this.index.remove(`${root}/${path}`);
    });
  }

  move(root: string, from: string, to: string): Promise<void> {
    return this.serial.run(async () => {
      this.pending.push(
        `R ${fastImportPath(`${root}/${from}`)} ${fastImportPath(`${root}/${to}`)}\n`,
      );
      this.index.remove(`${root}/${from}`);
      this.index.add(`${root}/${to}`);
    });
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
    // The session's first commit starts from its start tree; later ones continue the ref.
    if (!this.committedThisSession) {
      await this.stream.command(
        this.startFrom === null ? "deleteall\n" : `from ${this.startFrom}\n`,
      );
    }
    for (const line of this.pending.splice(0)) {
      await this.stream.command(line);
    }
    await this.stream.command("\n");
    this.committedThisSession = true;
    await this.stream.sync();
  }

  // Commits the pull on servicenow-remote/<name>. An incremental pull that changed nothing
  // leaves the branch where it was.
  async finish(message: string): Promise<FinishedPull> {
    await this.serial.run(async () => {
      await this.commitProgress();
      await this.stream.finish();
    });
    const ref = GitMirror.progressRef(this.instance);
    const progress = await revParse(this.repository, ref);
    const branch = GitMirror.remoteBranch(this.instance);
    const parent = await revParse(this.repository, branch);
    if (
      this.mode === "incremental" &&
      (progress === null || (await this.sameTree(progress, parent)))
    ) {
      await runGit(["update-ref", "-d", ref], this.repository);
      return { commit: parent ?? "", created: false };
    }
    const tree =
      progress === null
        ? EMPTY_TREE
        : (await runGitOrThrow(["rev-parse", `${progress}^{tree}`], this.repository)).trim();
    const commit = await this.commitTree(tree, parent, message);
    await runGitOrThrow(["update-ref", branch, commit], this.repository);
    await runGit(["update-ref", "-d", ref], this.repository);
    await this.compact();
    return { commit, created: true };
  }

  private async sameTree(a: string, b: string | null): Promise<boolean> {
    return b !== null && (await runGit(["diff", "--quiet", a, b], this.repository)).exitCode === 0;
  }

  // A full pull ends with one optimized pack; unreachable progress objects are dropped
  // (reflog-reachable objects are kept, so local history is safe). Measured on the PDI:
  // 585 MB -> 230 MB in 11 s. Incremental pulls add small packs that git consolidates
  // when they pile up.
  private async compact(): Promise<void> {
    if (this.mode === "incremental") {
      await runGitOrThrow(["gc", "--auto", "--quiet"], this.repository);
      return;
    }
    await runGitOrThrow(["repack", "-a", "-d", "-q"], this.repository);
    await runGitOrThrow(["prune-packed", "-q"], this.repository);
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
    this.index.add(path);
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
