import { isCredentialVariable } from "@snagentic/core";

type Environment = Readonly<Record<string, string | undefined>>;

// The environment for every process snagentic starts (git, gh, tar, media tools, a new binary):
// the parent's, plus the caller's additions, without any instance credential (spec 012, step 3).
// The tools keep everything else, their own sign-ins and proxies included.
export function childEnvironment(
  extra: Environment = {},
  parent: Environment = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries({ ...parent, ...extra })) {
    if (value !== undefined && !isCredentialVariable(name)) env[name] = value;
  }
  return env;
}
