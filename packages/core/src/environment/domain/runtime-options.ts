import { SnagenticError } from "../../kernel/errors";

type Environment = Readonly<Record<string, string | undefined>>;

// The variable through which the runtime inside the binary takes arguments of its own.
const RUNTIME_OPTIONS = "BUN_OPTIONS";

export class RuntimeOptionsError extends SnagenticError {
  constructor() {
    super(
      "runtime-options-set",
      "not-permitted",
      `${RUNTIME_OPTIONS} is set: snagentic runs only with the runtime options it was built with`,
      `unset ${RUNTIME_OPTIONS} for snagentic (in the shell, or in the config that starts it) and ` +
        "run the command again",
    );
  }
}

// The refusal for a process started with runtime options from its environment, or null. The
// value is never repeated: it can carry anything. The runtime has applied the options by the
// time this runs, so this stops the command; it is not what keeps them out
// (docs/product/security-and-governance.md, "The runtime inside the binary").
export function runtimeOptionsRefusal(env: Environment): RuntimeOptionsError | null {
  return (env[RUNTIME_OPTIONS] ?? "").trim() === "" ? null : new RuntimeOptionsError();
}
