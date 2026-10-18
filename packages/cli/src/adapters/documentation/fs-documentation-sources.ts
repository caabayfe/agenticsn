import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DocumentationSourceError,
  type DocumentationSources,
  type PageSource,
  type SceneSource,
  splitFrontMatter,
  type ThemeFile,
} from "@snagentic/core";
import { isMap, parse, parseDocument } from "yaml";

const FOLDER = "documentation";

// A file's YAML or JSON, or an error naming the file and the line, for the author to fix.
function parsed(path: string, text: string, as: "yaml" | "json" = "yaml"): unknown {
  try {
    return as === "json" ? JSON.parse(text) : parse(text);
  } catch (error) {
    const reason = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
    throw new DocumentationSourceError(path, `is not valid ${as.toUpperCase()}: ${reason}`);
  }
}

async function textIfExists(path: string): Promise<string | null> {
  return existsSync(path) ? readFile(path, "utf8") : null;
}

async function list(root: string, pattern: string): Promise<string[]> {
  if (!existsSync(root)) {
    return [];
  }
  const found: string[] = [];
  for await (const path of new Bun.Glob(pattern).scan({ cwd: root })) {
    found.push(path);
  }
  return found.sort();
}

// documentation/ in the workspace: site.yaml, processes/<id>/process.yaml and its pages
// (<section>/<topic>.md), animations/<name>/ (ADR-0036, spec 010a).
export class FsDocumentationSources implements DocumentationSources {
  private readonly root: string;

  constructor(workspace: string) {
    this.root = join(workspace, FOLDER);
  }

  async site(): Promise<unknown> {
    const text = await textIfExists(join(this.root, "site.yaml"));
    return text === null ? null : (parsed("site.yaml", text) ?? {});
  }

  async processes() {
    const processes: { path: string; process: unknown }[] = [];
    for (const path of await list(this.root, "processes/*/process.yaml")) {
      processes.push({
        path,
        process: parsed(path, await readFile(join(this.root, path), "utf8")) ?? {},
      });
    }
    return processes;
  }

  async pages(): Promise<readonly PageSource[]> {
    const pages: PageSource[] = [];
    for (const path of await list(this.root, "processes/*/*/*.md")) {
      const split = splitFrontMatter(await readFile(join(this.root, path), "utf8"));
      pages.push({
        path,
        frontMatter: split.frontMatter === null ? {} : parsed(path, split.frontMatter),
        body: split.body,
      });
    }
    return pages;
  }

  // documentation/theme/: every file, as bytes (CSS, images, fonts).
  async theme(): Promise<readonly ThemeFile[]> {
    const folder = join(this.root, "theme");
    const files: ThemeFile[] = [];
    for (const path of await list(folder, "**/*")) {
      files.push({ path, content: new Uint8Array(await readFile(join(folder, path))) });
    }
    return files;
  }

  async scenes(): Promise<readonly SceneSource[]> {
    const scenes: SceneSource[] = [];
    for (const file of await list(this.root, "animations/*/animation.json")) {
      const path = file.slice(0, -"/animation.json".length);
      const read = (name: string) => textIfExists(join(this.root, path, name));
      const steps = await read("steps.json");
      scenes.push({
        path,
        animation: parsed(`${path}/animation.json`, (await read("animation.json")) ?? "{}", "json"),
        svg: (await read("scene.svg")) ?? "",
        css: await read("scene.css"),
        steps: steps === null ? [] : parsed(`${path}/steps.json`, steps, "json"),
      });
    }
    return scenes;
  }

  // Edits the front matter as a YAML document, so comments and order stay as the author wrote.
  async pinHashes(path: string, hashes: ReadonlyMap<string, string>): Promise<void> {
    const file = join(this.root, path);
    const source = await readFile(file, "utf8");
    const split = splitFrontMatter(source);
    if (split.frontMatter === null) {
      return;
    }
    const document = parseDocument(split.frontMatter);
    for (const [id, hash] of hashes) {
      if (isMap(document.getIn(["evidence", id]))) {
        document.setIn(["evidence", id, "hash"], hash);
      }
    }
    await writeFile(file, `---\n${document.toString({ lineWidth: 0 })}---\n${split.body}`);
  }
}
