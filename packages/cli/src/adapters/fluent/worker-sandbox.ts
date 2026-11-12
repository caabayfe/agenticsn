import { existsSync } from "node:fs";
import { LOW_INTEGRITY_FOLDERS } from "./windows-confinement";

// Where the operating system offers it, the SDK worker can write only to its build copy and its
// scratch folder, and on macOS also has no network (ADR-0044 item 6, ADR-0055 for Windows).

export type Isolation = "sandbox-exec" | "low-integrity" | "none";

export interface Sandboxed {
  readonly command: readonly string[];
  readonly isolation: Isolation;
  // Added to the worker's environment: on Windows the worker confines itself, as asked here.
  readonly environment?: Readonly<Record<string, string>>;
}

// Wraps `command`, allowing writes under `writable` (real paths) only.
export type Sandbox = (command: readonly string[], writable: readonly string[]) => Sandboxed;

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

const quoted = (path: string) => `"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

// sandbox-exec's profile language: everything allowed except the network and writes outside
// the given folders and the standard streams.
export function macosProfile(writable: readonly string[]): string {
  const allowed = [
    ...writable.map((path) => `(subpath ${quoted(path)})`),
    ...["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/tty"].map((p) => `(literal "${p}")`),
  ];
  return [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    `(deny file-write* (require-not (require-any ${allowed.join(" ")})))`,
  ].join("");
}

export interface SandboxHost {
  readonly platform: NodeJS.Platform;
  readonly exists: (path: string) => boolean;
}

const SYSTEM: SandboxHost = { platform: process.platform, exists: existsSync };

export function osSandbox(host: SandboxHost = SYSTEM): Sandbox {
  return (command, writable) => {
    if (host.platform === "darwin" && host.exists(SANDBOX_EXEC)) {
      return {
        command: [SANDBOX_EXEC, "-p", macosProfile(writable), ...command],
        isolation: "sandbox-exec",
      };
    }
    if (host.platform === "win32") {
      const environment = { [LOW_INTEGRITY_FOLDERS]: JSON.stringify(writable) };
      return { command, isolation: "low-integrity", environment };
    }
    return { command, isolation: "none" };
  };
}

// No sandbox: the worker still holds no credential (ADR-0044, item 3).
export const NO_SANDBOX: Sandbox = (command) => ({ command, isolation: "none" });
