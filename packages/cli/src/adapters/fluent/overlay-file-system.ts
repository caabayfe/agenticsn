import * as fs from "node:fs";
import { dirname, resolve, sep } from "node:path";
import type { FileSystem } from "@servicenow/sdk-build-core";
import type { TypeFiles } from "./type-files";

type Kind = "file" | "directory";
type Encoding = FileSystem.Encoding;

function notFound(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), {
    code: "ENOENT",
    errno: -2,
    path,
  });
}

function entryOf(name: string, kind: Kind): FileSystem.Entry & FileSystem.Stats {
  return {
    name,
    isFile: () => kind === "file",
    isDirectory: () => kind === "directory",
    isSymbolicLink: () => false,
    isCharacterDevice: () => false,
    isBlockDevice: () => false,
    isSocket: () => false,
    isFIFO: () => false,
  };
}

// Directory -> names directly inside it, for every directory above a file.
function indexDirectories(files: TypeFiles): Map<string, Set<string>> {
  const directories = new Map<string, Set<string>>();
  for (const key of files.keys()) {
    let child = key;
    for (;;) {
      const parent = dirname(child) === "." ? "" : dirname(child);
      const names = directories.get(parent) ?? new Set<string>();
      names.add(parent === "" ? child : child.slice(parent.length + 1));
      directories.set(parent, names);
      if (parent === "") break;
      child = parent;
    }
  }
  return directories;
}

// Windows paths compare without case: TypeScript and Node may disagree on the drive letter's.
const fold = (path: string) => (process.platform === "win32" ? path.toLowerCase() : path);

// Serves <rootDir>/node_modules/** from the embedded type files and passes every other path to
// the real file system, so a workspace needs no node_modules (ADR-0028 as amended, item 6).
export class OverlayFileSystem implements FileSystem {
  readonly #base: string;
  readonly #files: TypeFiles;
  readonly #directories: Map<string, Set<string>>;

  constructor(rootDir: string, files: TypeFiles) {
    this.#base = `${resolve(rootDir, "node_modules")}${sep}`;
    this.#files = files;
    this.#directories = indexDirectories(files);
  }

  // The path under node_modules with "/", or null when the real file system answers.
  #embedded(path: string): string | null {
    const full = resolve(path);
    if (fold(`${full}${sep}`) === fold(this.#base)) return "";
    if (!fold(full).startsWith(fold(this.#base))) return null;
    return full.slice(this.#base.length).split(sep).join("/");
  }

  #kind(key: string): Kind | null {
    if (this.#files.has(key)) return "file";
    return this.#directories.has(key) ? "directory" : null;
  }

  #stat(path: string): FileSystem.Stats {
    const key = this.#embedded(path);
    if (key === null) return fs.statSync(path);
    const kind = this.#kind(key);
    if (kind === null) throw notFound(path);
    return entryOf(key, kind);
  }

  statSync(path: string): FileSystem.Stats {
    return this.#stat(path);
  }

  lstatSync(path: string): FileSystem.Stats {
    return this.#embedded(path) === null ? fs.lstatSync(path) : this.#stat(path);
  }

  accessSync(path: string): void {
    const key = this.#embedded(path);
    if (key === null) {
      fs.accessSync(path);
    } else if (this.#kind(key) === null) {
      throw notFound(path);
    }
  }

  realpathSync(path: string): string {
    const key = this.#embedded(path);
    if (key === null) return fs.realpathSync(path);
    if (this.#kind(key) === null) throw notFound(path);
    return resolve(path);
  }

  readFileSync(path: string, options?: { flag: "r" }): Buffer;
  readFileSync(path: string, options: { encoding: Encoding; flag?: "r" }): string;
  readFileSync(path: string, options?: { encoding?: Encoding; flag?: "r" }): string | Buffer;
  readFileSync(path: string, options?: { encoding?: Encoding; flag?: "r" }): string | Buffer {
    const key = this.#embedded(path);
    const encoding = options?.encoding;
    if (key === null) {
      return encoding === undefined ? fs.readFileSync(path) : fs.readFileSync(path, encoding);
    }
    const text = this.#files.get(key);
    if (text === undefined) throw notFound(path);
    return encoding === undefined ? Buffer.from(text) : text;
  }

  readdirSync(path: string): string[];
  readdirSync(path: string, options: { withFileTypes: true }): FileSystem.Entry[];
  readdirSync(path: string, options?: { withFileTypes: boolean }): string[] | FileSystem.Entry[];
  readdirSync(path: string, options?: { withFileTypes: boolean }): string[] | FileSystem.Entry[] {
    const key = this.#embedded(path);
    if (key === null) {
      return options?.withFileTypes
        ? fs.readdirSync(path, { withFileTypes: true })
        : fs.readdirSync(path);
    }
    const names = this.#directories.get(key);
    if (names === undefined) throw notFound(path);
    if (!options?.withFileTypes) return [...names];
    return [...names].map((name) =>
      entryOf(name, this.#kind(key === "" ? name : `${key}/${name}`) ?? "file"),
    );
  }

  rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void {
    fs.rmSync(path, options);
  }

  mkdirSync(path: string): void;
  mkdirSync(path: string, options: { recursive: true }): string | undefined;
  mkdirSync(path: string, options?: { recursive: boolean }): string | undefined;
  mkdirSync(path: string, options?: { recursive: boolean }): string | undefined {
    return fs.mkdirSync(path, options);
  }

  renameSync(oldPath: string, newPath: string): void {
    fs.renameSync(oldPath, newPath);
  }

  writeFileSync(
    path: string,
    content: string | NodeJS.ArrayBufferView,
    options?: { encoding: Encoding },
  ): void {
    fs.writeFileSync(path, content, options);
  }

  copyFileSync(srcPath: string, destPath: string): void {
    fs.copyFileSync(srcPath, destPath);
  }
}
