// A published release: its version and notes (the changelog section).
export interface ReleaseInfo {
  readonly version: string;
  readonly notes: string;
}

// The project's releases on GitHub (ADR-0023). Failures throw ReleaseUnavailableError.
export interface ReleaseSource {
  latest(signal: AbortSignal): Promise<ReleaseInfo>;
  // Recent releases, newest first: enough to cover the versions an upgrade skips over.
  list(signal: AbortSignal): Promise<readonly ReleaseInfo[]>;
  download(
    version: string,
    asset: string,
    signal: AbortSignal,
  ): Promise<{ readonly binary: Uint8Array; readonly sums: string }>;
}

// The executable that is running.
export interface InstalledBinary {
  // Its path when installed from a release, or null when running from source.
  readonly path: string | null;
  // Writes `binary` beside it, checks it reports `version`, then swaps it in.
  replace(binary: Uint8Array, version: string): Promise<void>;
  // Runs the installed executable (after a replace, the new one).
  run(
    args: readonly string[],
    cwd: string,
  ): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }>;
}

// When the notice last asked GitHub, and what it found.
export interface UpdateCheck {
  readonly checkedAt: string;
  readonly latest: string | null;
}

export interface UpdateCheckStore {
  read(): Promise<UpdateCheck | null>;
  write(check: UpdateCheck): Promise<void>;
}
