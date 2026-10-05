export interface GitResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

// Runs git without ever prompting (no terminal, no credential helper dialogs).
export async function runGit(args: readonly string[], cwd: string): Promise<GitResult> {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

export async function runGitOrThrow(args: readonly string[], cwd: string): Promise<string> {
  const result = await runGit(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

// Streams git's output line by line, so large listings are never held as one string.
// `success` lists the exit codes that are not failures (git grep exits 1 on no match).
export async function* gitLines(
  args: readonly string[],
  cwd: string,
  success: readonly number[] = [0],
): AsyncGenerator<string> {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const stderr = new Response(child.stderr).text();
  const decoder = new TextDecoder();
  let rest = "";
  for await (const chunk of child.stdout) {
    const lines = (rest + decoder.decode(chunk, { stream: true })).split("\n");
    rest = lines.pop() ?? "";
    yield* lines;
  }
  if (rest !== "") {
    yield rest;
  }
  if (!success.includes(await child.exited)) {
    throw new Error(`git ${args.join(" ")} failed: ${(await stderr).trim()}`);
  }
}
