import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import {
  type AuthoringWorkspace,
  FLUENT_SOURCE_DIR,
  LEDGER_FILE,
  type Ledger,
  LedgerUncommittedError,
  ledgerDocument,
  ledgerOf,
  PathOutsideProjectError,
  type SourceProject,
} from "@snagentic/core";
import { runGit, runGitOrThrow } from "../git/run-git";
import { fromYamlStrings, toYaml } from "../yaml/own-style";
import type { LoadFluentRuntime } from "./fluent-runtime-loader";

const LEDGER_HEADER =
  "# Written by snagentic: what each development instance held when it last agreed with this\n" +
  "# project's source (ADR-0033). Never edit it by hand.\n";

const readText = (path: string) => readFile(path, "utf8").catch(() => null);

function configOf(text: string | null): { scope: string; scopeId: string } | null {
  if (text === null) return null;
  const config: unknown = JSON.parse(text);
  if (typeof config !== "object" || config === null) return null;
  const scope = Reflect.get(config, "scope");
  const scopeId = Reflect.get(config, "scopeId");
  return typeof scope === "string" && typeof scopeId === "string" ? { scope, scopeId } : null;
}

// `path` under `folder`, refusing one that resolves anywhere else ("..", absolute paths).
function inside(folder: string, path: string): string {
  const file = resolve(folder, path);
  const within = relative(resolve(folder), file);
  if (within === "" || within.startsWith("..") || resolve(folder, within) !== file) {
    throw new PathOutsideProjectError(path, folder);
  }
  return file;
}

// The workspace's Fluent projects, one per scope under source/<scope>/ (ADR-0031).
export class WorkspaceAuthoring implements AuthoringWorkspace {
  constructor(
    private readonly workspace: string,
    private readonly load: LoadFluentRuntime,
  ) {}

  async projects(): Promise<readonly SourceProject[]> {
    const folders = await readdir(join(this.workspace, FLUENT_SOURCE_DIR)).catch(() => []);
    const found: SourceProject[] = [];
    for (const folder of [...folders].sort()) {
      const project = await this.project(folder);
      if (project !== null) found.push(project);
    }
    return found;
  }

  async project(scope: string): Promise<SourceProject | null> {
    const path = `${FLUENT_SOURCE_DIR}/${scope}`;
    const folder = inside(join(this.workspace, FLUENT_SOURCE_DIR), scope);
    const config = configOf(await readText(join(folder, "now.config.json")));
    return config === null ? null : { path, scope: config.scope, scopeId: config.scopeId };
  }

  async scaffold(scope: { readonly name: string; readonly sysId: string }): Promise<SourceProject> {
    const path = `${FLUENT_SOURCE_DIR}/${scope.name}`;
    inside(join(this.workspace, FLUENT_SOURCE_DIR), scope.name);
    const sdk = (await this.load()).sdkVersion;
    const config = {
      scope: scope.name,
      scopeId: scope.sysId,
      name: scope.name,
      type: "configuration",
    };
    const manifest = {
      name: scope.name.replace(/_/g, "-"),
      version: "0.0.1",
      private: true,
      devDependencies: { "@servicenow/sdk": sdk },
    };
    const files: [string, string][] = [
      ["now.config.json", `${JSON.stringify(config, null, 4)}\n`],
      ["package.json", `${JSON.stringify(manifest, null, 4)}\n`],
      [".gitignore", "node_modules/\ndist/\n.now/\n"],
    ];
    for (const [name, content] of files) {
      const file = join(this.workspace, path, name);
      await mkdir(dirname(file), { recursive: true });
      if ((await readText(file)) === null) await writeFile(file, content);
    }
    await mkdir(join(this.workspace, path, "src", "fluent"), { recursive: true });
    return { path, scope: scope.name, scopeId: scope.sysId };
  }

  async readLedger(project: SourceProject): Promise<Ledger> {
    const path = `${project.path}/${LEDGER_FILE}`;
    const text = await readText(join(this.workspace, path));
    return ledgerOf(path, text === null ? null : fromYamlStrings(text));
  }

  async writeFiles(project: SourceProject, files: ReadonlyMap<string, string>): Promise<void> {
    for (const [path, text] of files) {
      const file = inside(join(this.workspace, project.path), path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, text);
    }
  }

  async ledgerCommit(project: SourceProject): Promise<string | null> {
    const path = `${project.path}/${LEDGER_FILE}`;
    const status = await runGitOrThrow(["status", "--porcelain", "--", path], this.workspace);
    if (status.trim() !== "") throw new LedgerUncommittedError(path);
    // A repository with no commit yet has no ledger commit either.
    const log = await runGit(["log", "-1", "--format=%H", "--", path], this.workspace);
    const commit = log.exitCode === 0 ? log.stdout.trim() : "";
    return commit === "" ? null : commit;
  }

  // git merge-file per file: ours is the working tree, base the file at `base`, theirs the
  // refreshed conversion. A file new on both sides merges against an empty base.
  async mergeFiles(
    project: SourceProject,
    base: string,
    theirs: ReadonlyMap<string, string>,
  ): Promise<readonly string[]> {
    const conflicts: string[] = [];
    const scratch = await mkdtemp(join(tmpdir(), "snagentic-merge-"));
    try {
      for (const [path, text] of theirs) {
        const file = inside(join(this.workspace, project.path), path);
        const shown = await runGit(["show", `${base}:${project.path}/${path}`], this.workspace);
        // A file deleted locally is the empty text: git then reports the instance's change.
        const ours = join(scratch, "local");
        const common = join(scratch, "base");
        const instance = join(scratch, "instance");
        await writeFile(ours, (await readText(file)) ?? "");
        await writeFile(common, shown.exitCode === 0 ? shown.stdout : "");
        await writeFile(instance, text);
        const labels = ["-L", "local", "-L", "base", "-L", "instance"];
        const merged = await runGit(
          ["merge-file", "-p", ...labels, ours, common, instance],
          scratch,
        );
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, merged.stdout);
        if (merged.exitCode !== 0) conflicts.push(path);
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
    return conflicts.sort();
  }

  async writeLedger(project: SourceProject, ledger: Ledger): Promise<void> {
    const file = join(this.workspace, project.path, LEDGER_FILE);
    await writeFile(file, `${LEDGER_HEADER}${toYaml(ledgerDocument(ledger))}`);
  }
}
