type Environment = Readonly<Record<string, string | undefined>>;

// What the SDK worker may see of snagentic's environment: enough to start a process and format
// text, nothing to sign in with. An allow-list, not childEnvironment(): that one keeps every
// token the parent has (git and gh need theirs), and the worker needs none (ADR-0044, item 3).
const PASSED = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "TZ",
  // Windows, to start a process and find the user's folders.
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "USERPROFILE",
  "LOCALAPPDATA",
]);

export function workerEnvironment(
  scratch: string,
  parent: Environment = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) {
    // Windows names are not case-sensitive.
    if (value !== undefined && PASSED.has(name.toUpperCase())) env[name] = value;
  }
  // The SDK unpacks what it reads into the temporary folder: the worker's own.
  for (const name of ["TMPDIR", "TMP", "TEMP"]) env[name] = scratch;
  env["NO_TELEMETRY"] = "1";
  return env;
}
