import { parseRawTimestamp } from "./raw-timestamp";

// Where an instance stands in the pull -> integrate cycle, and the command that moves it on.
export type SyncPhase = "never-pulled" | "interrupted" | "not-integrated" | "integrated";

export interface SyncFacts {
  readonly pulled: boolean;
  readonly interrupted: boolean;
  readonly unintegratedPulls: number;
}

export function syncPhase(facts: SyncFacts): SyncPhase {
  if (facts.interrupted) {
    return "interrupted";
  }
  if (!facts.pulled) {
    return "never-pulled";
  }
  return facts.unintegratedPulls > 0 ? "not-integrated" : "integrated";
}

export function nextCommand(phase: SyncPhase, instance: string): string {
  return phase === "not-integrated"
    ? `snagentic integrate ${instance}`
    : `snagentic pull ${instance}`;
}

// Whole minutes between a raw UTC timestamp ("YYYY-MM-DD HH:MM:SS") and now.
export function minutesSince(timestamp: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - parseRawTimestamp(timestamp)) / 60_000));
}
