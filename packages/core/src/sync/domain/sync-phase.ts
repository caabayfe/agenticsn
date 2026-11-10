import { parseRawTimestamp } from "../../kernel/raw-timestamp";

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

// With a shared mirror (ADR-0052 item 6): whether it holds pulls this clone lacks, and whether a
// pull would ask the instance anything (the same `current` the pull itself decides on).
export interface SharedFacts {
  readonly ahead: boolean;
  readonly current: boolean;
  // ADR-0052 A2: older than its max age and published by another user, so this clone's pull
  // takes it as it is unless --now asks.
  readonly stale?: boolean;
  readonly publisher?: string | null;
  readonly ageMinutes?: number | null;
  readonly maxAgeMinutes?: number;
}

export const NOTHING_TO_DO = "nothing: the mirror is current";

// The way to fresher data than a stale shared mirror: its publisher's next pull, or --now.
function staleNext(instance: string, shared: SharedFacts): string {
  const age = `${shared.ageMinutes ?? "?"} min old, max ${shared.maxAgeMinutes ?? "?"}`;
  return `nothing yet: the shared mirror is stale (${age}); wait for ${shared.publisher ?? "its publisher"}'s next scheduled pull, or run snagentic pull ${instance} --now`;
}

export function nextCommand(phase: SyncPhase, instance: string, shared?: SharedFacts): string {
  const integrate = `snagentic integrate ${instance}`;
  const pull = `snagentic pull ${instance}`;
  const stale = shared?.stale === true;
  // Only --now resumes a developer's interrupted pull while the mirror is stale.
  if (phase === "interrupted") return stale ? `${pull} --now` : pull;
  if (shared?.ahead === true || phase === "not-integrated") return integrate;
  if (stale) return staleNext(instance, shared);
  return shared?.current === true ? NOTHING_TO_DO : pull;
}

// Whole minutes between a raw UTC timestamp ("YYYY-MM-DD HH:MM:SS") and now.
export function minutesSince(timestamp: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - parseRawTimestamp(timestamp)) / 60_000));
}
