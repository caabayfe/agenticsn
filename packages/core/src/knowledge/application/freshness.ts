import { minutesSince } from "../../sync/domain/sync-phase";
import type { Freshness, KnowledgeDependencies } from "./knowledge-dependencies";

// Older than this, results say the mirror is stale and suggest a pull.
export const STALE_AFTER_MINUTES = 24 * 60;

export function freshness(deps: KnowledgeDependencies): Freshness {
  return {
    asOf: deps.asOf,
    stale: deps.asOf === null || minutesSince(deps.asOf, deps.now()) > STALE_AFTER_MINUTES,
  };
}
