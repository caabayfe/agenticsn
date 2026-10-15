// Spike S13/A1: a fileSystem for the SDK's Project that serves <root>/node_modules/** from an
// embedded map of files, and passes every other path to the real fs.
import * as fs from "node:fs";
import { dirname, resolve, sep } from "node:path";

type Files = Readonly<Record<string, string>>;
type Kind = "file" | "dir" | null;
type Method = (...args: unknown[]) => unknown;

const enoent = (path: string) =>
  Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), {
    code: "ENOENT",
    errno: -2,
    path,
  });

// Directory -> the names directly inside it, for every directory above an embedded file.
function indexDirectories(files: Files): Map<string, Set<string>> {
  const dirs = new Map<string, Set<string>>();
  for (const rel of Object.keys(files)) {
    let child = rel;
    for (;;) {
      const parent = dirname(child);
      const key = parent === "." ? "" : parent;
      const names = dirs.get(key) ?? new Set<string>();
      names.add(child.slice(key === "" ? 0 : key.length + 1));
      dirs.set(key, names);
      if (key === "") break;
      child = key;
    }
  }
  return dirs;
}

function fakeStats(kind: Kind, size: number, path: string) {
  if (kind === null) throw enoent(path);
  const time = new Date(0);
  return {
    isFile: () => kind === "file",
    isDirectory: () => kind === "dir",
    isSymbolicLink: () => false,
    size,
    mtime: time,
    ctime: time,
    atime: time,
    birthtime: time,
    mtimeMs: 0,
    mode: kind === "dir" ? 0o40755 : 0o100644,
  };
}

// Windows paths compare without case: TypeScript and Node may disagree on the drive letter's.
const fold = (path: string) => (process.platform === "win32" ? path.toLowerCase() : path);

function relativeTo(base: string, path: unknown): string | null {
  if (typeof path !== "string") return null;
  const full = resolve(path);
  if (fold(`${full}${sep}`) === fold(base)) return "";
  return fold(full).startsWith(fold(base)) ? full.slice(base.length).split(sep).join("/") : null;
}

function readers(files: Files, dirs: Map<string, Set<string>>) {
  const kind = (rel: string): Kind => (rel in files ? "file" : dirs.has(rel) ? "dir" : null);
  const stat = (rel: string, path: string) =>
    fakeStats(kind(rel), Buffer.byteLength(files[rel] ?? ""), path);
  const read = (rel: string, path: string, options: unknown) => {
    const text = files[rel];
    if (text === undefined) throw enoent(path);
    const encoding =
      typeof options === "string"
        ? options
        : (options as { encoding?: string } | undefined)?.encoding;
    return encoding ? text : Buffer.from(text);
  };
  const list = (rel: string, path: string, options: unknown) => {
    const names = dirs.get(rel);
    if (names === undefined) throw enoent(path);
    if (!(options as { withFileTypes?: boolean } | undefined)?.withFileTypes) return [...names];
    return [...names].map((name) => ({
      name,
      ...stat(rel === "" ? name : `${rel}/${name}`, name),
    }));
  };
  return { kind, stat, read, list };
}

export function overlayFs(rootDir: string, files: Files): typeof fs {
  const base = `${resolve(rootDir, "node_modules")}${sep}`;
  const { kind, stat, read, list } = readers(files, indexDirectories(files));
  const real = fs as unknown as Record<string, Method>;
  // Each override answers for embedded paths and calls the real method for the rest.
  const embedded =
    (name: string, answer: (rel: string, path: string, options: unknown) => unknown) =>
    (path: unknown, options?: unknown) => {
      const rel = relativeTo(base, path);
      return rel === null ? real[name]?.(path, options) : answer(rel, String(path), options);
    };
  const statOrUndefined = (rel: string, path: string, options: unknown) => {
    if (kind(rel) === null && (options as { throwIfNoEntry?: boolean })?.throwIfNoEntry === false) {
      return undefined;
    }
    return stat(rel, path);
  };
  const realpath = embedded("realpathSync", (rel, path) => {
    if (kind(rel) === null) throw enoent(path);
    return resolve(path);
  });
  const overrides: Record<string, Method> = {
    existsSync: embedded("existsSync", (rel) => kind(rel) !== null),
    accessSync: embedded("accessSync", (rel, path) => {
      if (kind(rel) === null) throw enoent(path);
    }),
    statSync: embedded("statSync", statOrUndefined),
    lstatSync: embedded("lstatSync", statOrUndefined),
    readFileSync: embedded("readFileSync", read),
    readdirSync: embedded("readdirSync", list),
    realpathSync: Object.assign(realpath, { native: realpath }),
  };
  return new Proxy(fs, {
    get: (target, prop: string) =>
      overrides[prop] ?? (target as unknown as Record<string, unknown>)[prop],
  });
}
