import type { Check } from "./check";

// Variables that change where snagentic's requests go, or which certificates it trusts. The
// runtime reads them (the proxy ones in either case). A person sets them for a corporate network
// in their own environment; agents and committed configs never do (docs/guides/network.md).
export const PROXY_VARIABLES = ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY"] as const;
export const TRUST_VARIABLES = [
  "NODE_EXTRA_CA_CERTS",
  "NODE_USE_SYSTEM_CA",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const;
// Variables that make the binary run other code or stop checking certificates.
export const RUNTIME_VARIABLES = [
  "BUN_BE_BUN",
  "BUN_OPTIONS",
  "NODE_OPTIONS",
  "NODE_TLS_REJECT_UNAUTHORIZED",
] as const;

type Environment = Readonly<Record<string, string | undefined>>;

// A proxy address can carry user:password@; doctor output is pasted into tickets.
export function redactProxy(value: string): string {
  return value.replace(/^([a-z][a-z0-9+.-]*:\/\/)?[^@/]*@/i, "$1***@");
}

function setNames(env: Environment, names: readonly string[], anyCase: boolean): string[] {
  const candidates = names.flatMap((name) => (anyCase ? [name, name.toLowerCase()] : [name]));
  return candidates.filter((name) => (env[name] ?? "") !== "");
}

function describe(env: Environment, names: readonly string[], redact: boolean): string {
  return names
    .map((name) => {
      const value = env[name] ?? "";
      return `${name}=${redact ? redactProxy(value) : value}`;
    })
    .join(", ");
}

// What doctor shows about the network: the proxy and the extra certificates in effect.
export function networkCheck(env: Environment): Check {
  const proxies = setNames(env, PROXY_VARIABLES, true);
  const trust = setNames(env, TRUST_VARIABLES, false);
  const route = proxies.length === 0 ? "direct connection" : describe(env, proxies, true);
  const certificates =
    trust.length === 0 ? "built-in certificate list" : describe(env, trust, false);
  return { name: "network", status: "ok", detail: `${route}; ${certificates}`, hint: null };
}

// The names in `keys` that redirect traffic, change trust or change the runtime.
export function riskyVariables(keys: readonly string[]): string[] {
  const risky = new Set<string>([...PROXY_VARIABLES, ...TRUST_VARIABLES, ...RUNTIME_VARIABLES]);
  return keys.filter((key) => risky.has(key.toUpperCase()));
}
