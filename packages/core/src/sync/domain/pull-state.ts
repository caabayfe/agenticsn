import { parseRawTimestamp } from "../../kernel/raw-timestamp";

// Relative to instances/<name>/: every pull commit carries the state and catalog it was pulled
// with, so any clone continues from git (ADR-0052 item 1).
export const PULL_FOLDER = "pull";
export const PULL_STATE_FILE = `${PULL_FOLDER}/state.yaml`;
export const PULL_CATALOG_FILE = `${PULL_FOLDER}/catalog.yaml`;

export interface Puller {
  // The instance user the pull signs in as.
  readonly user: string;
  readonly version: string;
}

interface Signed {
  readonly pulledBy?: string;
  readonly snagenticVersion?: string;
}

// The state a pull commit carries. A full pull's listings are this user's, so it names them; an
// incremental pull keeps the user its mirror was listed by (ADR-0052 item 4).
export function signedState<T extends Signed>(
  next: T,
  run: { readonly full: boolean; readonly puller: Puller },
): T {
  const pulledBy = run.full ? run.puller.user : (next.pulledBy ?? run.puller.user);
  return { ...next, pulledBy, snagenticVersion: run.puller.version };
}

// Only the user whose listings the mirror reflects removes a file because a listing no longer
// returns it: another user's narrower read access must not delete records (ADR-0052 item 4).
// State an earlier version wrote names no one: its clone's user wrote it.
export function removesByAbsence(pulledBy: string | undefined, user: string): boolean {
  return pulledBy === undefined || pulledBy === user;
}

// Raw UTC timestamps ("YYYY-MM-DD HH:MM:SS") order as text.
export function isLater(watermark: string, than: string): boolean {
  return watermark > than;
}

// Clocks differ by a little; a watermark further ahead than this would hide changes.
export const CLOCK_TOLERANCE_MINUTES = 5;

export function aheadOfClock(watermark: string, clock: number): boolean {
  return parseRawTimestamp(watermark) > clock + CLOCK_TOLERANCE_MINUTES * 60_000;
}

// A mirror younger than maxAge is current: a pull sends the instance nothing (ADR-0052 item 3).
// A watermark ahead of this clock is never current, so a pull goes on and checks it.
export function isCurrent(watermark: string, now: Date, maxAgeMinutes: number): boolean {
  const age = now.getTime() - parseRawTimestamp(watermark);
  return !aheadOfClock(watermark, now.getTime()) && age < maxAgeMinutes * 60_000;
}

// ADR-0052 A2: in team mode, a mirror older than maxAge is its publisher's to refresh. A pull by
// any other user takes it as it is unless --now asks, so a late or failed scheduled pull leaves
// one stale mirror, not one puller per developer. A mirror that names no publisher (no scheduled
// pull yet, or state from an earlier version) keeps the earlier rule, so a team can start.
// Returns the publisher this user waits for, or null.
export function waitsFor(
  publisher: string | undefined,
  user: string,
  current: boolean,
): string | null {
  return !current && publisher !== undefined && publisher !== user ? publisher : null;
}
