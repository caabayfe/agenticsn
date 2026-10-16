import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type AuthoringWorkspace,
  FLUENT_SOURCE_DIR,
  type Ledger,
  ledgerDocument,
  ledgerOf,
  type SourceProject,
} from "@snagentic/core";
import { fromYamlStrings, toYaml } from "../yaml/own-style";
import type { LoadFluentRuntime } from "./fluent-runtime-loader";

export const LEDGER_FILE = "snagentic.ledger.yaml";

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

// The workspace's Fluent projects, one per scope under source/<scope>/ (ADR-0031).
export class WorkspaceAuthoring implements AuthoringWorkspace {
  constructor(
    private readonly workspace: string,
    private readonly load: LoadFluentRuntime,
  ) {}

  async project(scope: string): Promise<SourceProject | null> {
    const path = `${FLUENT_SOURCE_DIR}/${scope}`;
    const config = configOf(await readText(join(this.workspace, path, "now.config.json")));
    return config === null ? null : { path, scope: config.scope, scopeId: config.scopeId };
  }

  async scaffold(scope: { readonly name: string; readonly sysId: string }): Promise<SourceProject> {
    const path = `${FLUENT_SOURCE_DIR}/${scope.name}`;
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

  async writeLedger(project: SourceProject, ledger: Ledger): Promise<void> {
    const file = join(this.workspace, project.path, LEDGER_FILE);
    await writeFile(file, `${LEDGER_HEADER}${toYaml(ledgerDocument(ledger))}`);
  }
}
