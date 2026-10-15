import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { FluentPackage, FluentPackages, FluentProjects } from "@snagentic/core";
import { buildInCopy, fromWorkingTree } from "./build-in-copy";
import type { LoadFluentRuntime } from "./fluent-runtime-loader";

const GZIPPED = /<([a-z_]+)>(H4sI[A-Za-z0-9+/=]+)<\/\1>/g;
const SBOM_NOISE = /\n\s*"(serialNumber|timestamp)": "[^"]*",?/g;

// What a plan id binds: gzipped values as their text (gzip encodings differ between runtimes),
// the SBOM's random serial number and build time left out (flows test plan, A4).
function normalized(xml: string): string {
  return xml
    .replace(GZIPPED, (_, tag: string, data: string) => {
      return `<${tag}>${gunzipSync(Buffer.from(data, "base64")).toString("utf8")}</${tag}>`;
    })
    .replace(SBOM_NOISE, "");
}

function digestOf(files: readonly { readonly name: string; readonly content: string }[]): string {
  const hash = createHash("sha256");
  for (const file of files) hash.update(`${file.name}\0${normalized(file.content)}\0`);
  return hash.digest("hex");
}

async function builtFiles(directory: string) {
  const names = (await readdir(directory, { recursive: true }).catch(() => []))
    .filter((name) => name.endsWith(".xml"))
    .sort();
  const files: { name: string; content: string }[] = [];
  for (const name of names) {
    files.push({ name: basename(name), content: await readFile(join(directory, name), "utf8") });
  }
  return files;
}

function scopeOf(config: string) {
  const parsed: unknown = JSON.parse(config);
  const value = (name: string) =>
    typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, name) : undefined;
  return {
    scope: String(value("scope") ?? ""),
    scopeId: String(value("scopeId") ?? ""),
    configuration: value("type") === "configuration",
  };
}

// The Fluent projects a push would deliver, each built in a copy (ADR-0028 as amended). A
// project that does not build is left out: validate reports its errors, and they block the
// gate.
export class WorkspaceFluentPackages implements FluentPackages {
  constructor(
    private readonly workspace: string,
    private readonly projects: FluentProjects,
    private readonly load: LoadFluentRuntime,
  ) {}

  async changedSince(commit: string): Promise<readonly FluentPackage[]> {
    const packages: FluentPackage[] = [];
    for (const project of await this.projects.changedSince(commit)) {
      const source = join(this.workspace, project.path);
      const files = await buildInCopy(this.load, fromWorkingTree(source), async (copy, outcome) =>
        outcome.success ? builtFiles(join(copy, "dist", "app")) : null,
      );
      if (files === null) continue;
      const config = await readFile(join(source, "now.config.json"), "utf8");
      packages.push({ project: project.path, ...scopeOf(config), files, digest: digestOf(files) });
    }
    return packages;
  }
}
