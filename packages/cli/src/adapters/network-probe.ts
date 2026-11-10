import { type EnvironmentProbe, networkCheck } from "@snagentic/core";

// Shows doctor's reader the proxy and extra certificates this process would use.
export function networkProbe(
  env: Readonly<Record<string, string | undefined>> = process.env,
): EnvironmentProbe {
  return { name: "network", run: async () => networkCheck(env) };
}
