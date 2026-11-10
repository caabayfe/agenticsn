import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, copyFile, link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Stand-ins for the programs snagentic starts (gh, a browser, a release binary) that run on
// every platform. Windows can't start a "#!/bin/sh" script or a .ts file as a program, so each
// stand-in is a real executable compiled by `bun build --compile`.

const EXE = process.platform === "win32" ? ".exe" : "";

// Runs the TypeScript beside the executable that has its name: <dir>/gh.exe runs <dir>/gh.ts.
const LAUNCHER = [
  'import { basename, dirname, join } from "node:path";',
  'import { pathToFileURL } from "node:url";',
  "const exe = process.execPath;",
  'const name = basename(exe).replace(/\\.exe$/i, "");',
  'await import(pathToFileURL(join(dirname(exe), name + ".ts")).href);',
  "",
].join("\n");

const compiled = new Map<string, Promise<string>>();

// Compiles `source` once per Bun version, shared by every test run on this machine.
function compile(source: string): Promise<string> {
  const key = createHash("sha256").update(`${Bun.version}\n${source}`).digest("hex").slice(0, 16);
  let done = compiled.get(key);
  if (done === undefined) {
    done = compileInto(join(tmpdir(), `snagentic-fake-program-${key}`), source);
    compiled.set(key, done);
  }
  return done;
}

async function compileInto(dir: string, source: string): Promise<string> {
  const program = join(dir, `program${EXE}`);
  if (existsSync(program)) return program;
  await mkdir(dir, { recursive: true });
  // A unique name first, then a rename: other test processes may compile the same program.
  const unique = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const entry = join(dir, `entry-${unique}.ts`);
  const output = join(dir, `program-${unique}${EXE}`);
  await writeFile(entry, source);
  const build = Bun.spawn([process.execPath, "build", "--compile", entry, "--outfile", output], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([new Response(build.stderr).text(), build.exited]);
  await rm(entry, { force: true });
  if (exitCode !== 0) throw new Error(`could not compile a fake program: ${stderr}`);
  await rename(output, program).catch(() => rm(output, { force: true }));
  return program;
}

// A program named `name` in `dir` that runs `behaviour` (TypeScript; its arguments are
// process.argv.slice(2)). Returns the path to start it by. On POSIX a shell script hands the
// file to bun; Windows gets the compiled launcher, hard-linked under the program's name.
export async function fakeProgram(dir: string, name: string, behaviour: string): Promise<string> {
  const program = join(dir, `${name}${EXE}`);
  const script = join(dir, `${name}.ts`);
  await writeFile(script, behaviour);
  if (process.platform !== "win32") {
    await writeFile(program, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    await chmod(program, 0o755);
    return program;
  }
  const launcher = await compile(LAUNCHER);
  await link(launcher, program).catch(() => copyFile(launcher, program));
  return program;
}

// The bytes of an executable that runs `source`, for a test that writes a binary itself.
export async function compiledProgram(source: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(await compile(source)));
}
