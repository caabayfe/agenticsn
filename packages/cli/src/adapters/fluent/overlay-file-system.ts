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

// The build may not change anything past its project folder.
function refused(path: string): Error {
  return Object.assign(new Error(`EPERM: outside the project being built, '${path}'`), {
    code: "EPERM",
    errno: -1,
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

// Each folder as given and as the file system names it (macOS: /var is /private/var).
function rootsOf(folders: readonly string[]): readonly string[] {
  return [
    ...new Set(
      folders.flatMap((folder) => {
        const given = resolve(folder);
        return [given, fs.existsSync(given) ? fs.realpathSync(given) : given];
      }),
    ),
  ].map(fold);
}

// Serves <rootDir>/node_modules/** from the embedded type files and passes every other path
// inside the project to the real file system, so a workspace needs no node_modules (ADR-0028 as
// amended, item 6). Nothing outside the project exists for the SDK, and it can change nothing
// there: a project's config names its output folders, which the SDK deletes before each build,
// and the SDK imports Prettier configs found in parent folders (spec 012, B-01 and B-03).
// `scratch` is a private folder the SDK may also use, for files it would put in the shared
// temporary folder.
export class OverlayFileSystem implements FileSystem {
  readonly #base: string;
  readonly #roots: readonly string[];
  readonly #files: TypeFiles;
  readonly #directories: Map<string, Set<string>>;

  constructor(rootDir: string, files: TypeFiles, scratch?: string) {
    this.#base = `${resolve(rootDir, "node_modules")}${sep}`;
    this.#roots = rootsOf(scratch === undefined ? [rootDir] : [rootDir, scratch]);
    this.#files = files;
    this.#directories = indexDirectories(files);
  }

  #inside(path: string): boolean {
    const full = fold(resolve(path));
    return this.#roots.some((root) => full === root || full.startsWith(`${root}${sep}`));
  }

  #readable(path: string): void {
    if (!this.#inside(path)) throw notFound(path);
  }

  #writable(...paths: readonly string[]): void {
    const outside = paths.find((path) => !this.#inside(path));
    if (outside !== undefined) throw refused(outside);
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
    this.#readable(path);
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
    this.#readable(path);
    return this.#embedded(path) === null ? fs.lstatSync(path) : this.#stat(path);
  }

  accessSync(path: string): void {
    this.#readable(path);
    const key = this.#embedded(path);
    if (key === null) {
      fs.accessSync(path);
    } else if (this.#kind(key) === null) {
      throw notFound(path);
    }
  }

  realpathSync(path: string): string {
    this.#readable(path);
    const key = this.#embedded(path);
    if (key === null) return fs.realpathSync(path);
    if (this.#kind(key) === null) throw notFound(path);
    return resolve(path);
  }

  readFileSync(path: string, options?: { flag: "r" }): Buffer;
  readFileSync(path: string, options: { encoding: Encoding; flag?: "r" }): string;
  readFileSync(path: string, options?: { encoding?: Encoding; flag?: "r" }): string | Buffer;
  readFileSync(path: string, options?: { encoding?: Encoding; flag?: "r" }): string | Buffer {
    this.#readable(path);
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
    this.#readable(path);
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
    this.#writable(path);
    fs.rmSync(path, options);
  }

  mkdirSync(path: string): void;
  mkdirSync(path: string, options: { recursive: true }): string | undefined;
  mkdirSync(path: string, options?: { recursive: boolean }): string | undefined;
  mkdirSync(path: string, options?: { recursive: boolean }): string | undefined {
    this.#writable(path);
    return fs.mkdirSync(path, options);
  }

  renameSync(oldPath: string, newPath: string): void {
    this.#writable(oldPath, newPath);
    fs.renameSync(oldPath, newPath);
  }

  writeFileSync(
    path: string,
    content: string | NodeJS.ArrayBufferView,
    options?: { encoding: Encoding },
  ): void {
    this.#writable(path);
    fs.writeFileSync(path, content, options);
  }

  copyFileSync(srcPath: string, destPath: string): void {
    this.#writable(srcPath, destPath);
    fs.copyFileSync(srcPath, destPath);
  }
}
