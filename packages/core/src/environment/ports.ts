import type { Check } from "./domain/check";

// One local capability snagentic depends on (git, keychain, search index, ...).
export interface EnvironmentProbe {
  readonly name: string;
  run(): Promise<Check>;
}
