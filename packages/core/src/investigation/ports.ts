import type { LiveQueryEntry } from "./domain/live-query-log";

// The local record of the live queries run against one instance (spec 016, D4). It lives in the
// workspace's local state, never in git. `path` names it in messages.
export interface LiveQueryLog {
  readonly path: string;
  append(entry: LiveQueryEntry): Promise<void>;
}
