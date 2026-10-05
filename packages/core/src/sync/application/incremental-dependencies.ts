import type { IncrementalMirror } from "../ports";
import type { PullDependencies } from "./pull-dependencies";

export interface IncrementalDependencies extends PullDependencies {
  readonly records: IncrementalMirror;
}
