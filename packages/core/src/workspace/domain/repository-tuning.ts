// git settings for repositories with hundreds of thousands of files (ADR-0014): `init` sets
// them, and any other clone of a workspace gets them from the first command that writes its
// mirror (spec 014, PERF2-04).
export interface RepositorySetting {
  readonly key: string;
  // The value snagentic sets.
  readonly value: string;
  // The value git resolves in any scope (repository, global, system); null when unset.
  readonly current: string | null;
}

// Only settings nobody set: a value the person chose, in any scope, even "false", stays.
export function missingSettings(
  settings: readonly RepositorySetting[],
): readonly RepositorySetting[] {
  return settings.filter((setting) => setting.current === null);
}

export function tuningCommands(settings: readonly RepositorySetting[]): string {
  return settings.map(({ key, value }) => `git config ${key} ${value}`).join("; ");
}
