// Runs an external media program (ffmpeg, piper, say) with an argument list, never a shell.
export interface ToolResult {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

export async function runTool(
  command: readonly string[],
  signal: AbortSignal,
  stdin?: Uint8Array,
): Promise<ToolResult> {
  const child = Bun.spawn([...command], {
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
    signal,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).bytes(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

export async function toolAvailable(command: readonly string[]): Promise<boolean> {
  try {
    return (await runTool(command, new AbortController().signal)).exitCode === 0;
  } catch {
    return false;
  }
}

export class MediaToolFailedError extends Error {
  constructor(tool: string, stderr: string) {
    super(`${tool} failed: ${stderr.trim().split("\n").slice(-3).join(" ")}`);
  }
}
