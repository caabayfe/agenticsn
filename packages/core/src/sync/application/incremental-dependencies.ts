import type { IncrementalMirror } from "../ports";
import type { PullDependencies } from "./pull-dependencies";

export interface IncrementalDependencies extends PullDependencies {
  readonly records: IncrementalMirror;
  // "keep" when the mirror was listed by another user: files are removed only for the
  // instance's own deletion records, never because a listing left them out (ADR-0052 item 4).
  readonly absence?: "remove" | "keep";
  // The instance's clock (epoch ms) once it has answered; null when unknown (ADR-0052 item 7).
  readonly instanceTime?: () => number | null;
}
