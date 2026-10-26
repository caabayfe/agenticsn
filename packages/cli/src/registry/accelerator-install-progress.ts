import type { InstallPlace, InstallProgress } from "@snagentic/core";
import type { ProgressEvent } from "./use-case";

// Where a module step stands, as [4/13], or [1-3/13] for the modules already installed.
const at = (place: InstallPlace | null) =>
  place === null
    ? ""
    : `[${place.first === place.last ? place.first : `${place.first}-${place.last}`}/${place.total}] `;

// An install's steps as progress lines: the run, then each step starting and how it ended.
export function installProgress(event: InstallProgress): ProgressEvent {
  switch (event.kind) {
    case "begin": {
      const left = event.modules - event.finished;
      return {
        message:
          event.finished === 0
            ? `installing ${event.title}: ${event.modules} module(s), plan ${event.planId}`
            : `resuming plan ${event.planId}, ${event.title}: ${event.finished} of ${event.modules} module(s) done before, ${left} to go`,
      };
    }
    case "start":
      return { message: `${at(event.place)}${event.step}`, depth: 1 };
    case "end":
      return {
        message: `${at(event.place)}${event.step} (${Math.round(event.seconds)} s): ${event.detail}`,
        depth: 1,
        outcome: event.outcome,
      };
  }
}
