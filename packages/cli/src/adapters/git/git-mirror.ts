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

// Streams a pull into git (spike S8). Progress is committed to refs/snagentic/pull/<name>
// at every checkpoint; finish() commits the final tree on servicenow-remote/<name>.
export class GitMirror implements MirrorSession {
  private readonly pending: string[] = [];
  private readonly written = new Set<string>();
  // One fast-import stream is shared by concurrent pull workers: every operation on it runs
  // alone, so blobs and commits are never interleaved.
  private readonly serial = serialQueue();
  // Set once this session has committed: fast-import then continues the ref by itself.
  private committedThisSession = false;

  private constructor(
    private readonly repository: string,
    private readonly instance: InstanceName,
    private readonly stream: FastImport,
    private readonly resumedPaths: readonly string[],
    private readonly resumedFrom: string | null,
  ) {}

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
      tip === null
        ? []
        : (await runGitOrThrow(["ls-tree", "-r", "--name-only", tip], repository))
            .split("\n")
            .filter(Boolean);
    return new GitMirror(repository, instance, FastImport.start(repository), paths, tip);
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
    const prefix = `${root}/`;
    for (const path of [...this.resumedPaths, ...this.written]) {
      const leaf = path.slice(prefix.length);
      if (
        path.startsWith(prefix) &&
        leaf.endsWith(".yaml") &&
        leaf.split("/").at(-1)?.split(".").length === 2
      ) {
        yield leaf.slice(0, -".yaml".length);
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
    return commit;
  }

  async abort(): Promise<void> {
    this.stream.kill();
  }

  private async add(path: string, content: string): Promise<void> {
    const mark = await this.stream.blob(content);
    this.pending.push(`M 100644 ${mark} ${fastImportPath(path)}\n`);
    this.written.add(path);
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
