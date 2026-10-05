import {
  type CredentialStore,
  type EnvironmentProbe,
  type ProfileStore,
  SnagenticError,
  type WorkspaceStore,
} from "@snagentic/core";
import { z } from "zod";
import type { CliIo } from "../../src/cli/run-cli";
import { defineUseCase, type UseCase, type UseCaseContext } from "../../src/registry/use-case";

export function fakeProbe(name: string, status: "ok" | "fail" | "unavailable"): EnvironmentProbe {
  return {
    name,
    run: async () => ({
      name,
      status,
      detail: `${name} detail`,
      hint: status === "ok" ? null : `fix ${name}`,
    }),
  };
}

// A workspace store with no workspaces; tests that need real folders use FsWorkspaceStore.
const NO_WORKSPACES: WorkspaceStore = {
  ancestorsOf: (directory) => [directory],
  readManifest: async () => null,
  isInsideGitRepository: async () => false,
  isEmptyOrMissing: async () => true,
  create: async () => {},
};

const NO_PROFILES: ProfileStore = {
  list: async () => [],
  read: async () => null,
  write: async () => {},
  remove: async () => {},
};

const NO_CREDENTIALS: CredentialStore = {
  read: async () => null,
  write: async () => {},
  remove: async () => false,
};

export const FAKE_CONTEXT: UseCaseContext = {
  environmentProbes: [fakeProbe("git", "ok"), fakeProbe("keychain", "unavailable")],
  workspaces: NO_WORKSPACES,
  profiles: NO_PROFILES,
  credentials: NO_CREDENTIALS,
  secrets: { read: async () => "" },
  host: { cwd: "/work", home: "/home/me", version: "snagentic test" },
};

export class FakeStaleError extends SnagenticError {
  constructor() {
    super("stale-mirror", "precondition", "mirror is stale", "run: snagentic pull");
  }
}

// A use case unknown to the generators, to prove they need no per-use-case code.
export function echoUseCase(overrides: Partial<UseCase> = {}): UseCase {
  const base = defineUseCase({
    name: "echo-text",
    description: "Echo text back.",
    input: z.object({
      message: z.string().describe("text to echo"),
      times: z.number().int().min(1).default(1),
      shout: z.boolean().default(false),
      style: z.enum(["plain", "quoted"]).default("plain"),
      label: z.string().optional(),
    }),
    output: z.object({ echoed: z.string() }),
    flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
    mcp: true,
    async handle(input) {
      if (input.message === "stale") {
        throw new FakeStaleError();
      }
      if (input.message === "crash") {
        throw new Error("internal detail");
      }
      const text = input.shout ? input.message.toUpperCase() : input.message;
      const styled = input.style === "quoted" ? `"${text}"` : text;
      return { echoed: Array.from({ length: input.times }, () => styled).join(" ") };
    },
    render(output) {
      return `echo: ${output.echoed}`;
    },
    exitCode() {
      return 0;
    },
  });
  return { ...base, ...overrides };
}

export interface CapturedIo extends CliIo {
  readonly out: () => string;
  readonly err: () => string;
}

export function captureIo(): CapturedIo {
  let out = "";
  let err = "";
  return {
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    out: () => out,
    err: () => err,
  };
}

// Reports two progress steps, then finishes.
export function progressUseCase(): UseCase {
  return echoUseCase({
    name: "progress-steps",
    handle: async (_input, _context, run) => {
      run.progress({ message: "reading catalog", completed: 1, total: 2 });
      run.progress({ message: "writing records", completed: 2, total: 2 });
      return { echoed: "done" };
    },
  });
}

// Waits until its run is cancelled, then stops the way an aborted fetch does.
export function waitForCancelUseCase(
  started: () => void = () => {},
  aborted: () => void = () => {},
): UseCase {
  return echoUseCase({
    name: "wait-for-cancel",
    handle: (_input, _context, run) =>
      new Promise((_resolve, reject) => {
        const stop = () => {
          aborted();
          reject(new DOMException("The operation was aborted.", "AbortError"));
        };
        run.signal.addEventListener("abort", stop, { once: true });
        started();
      }),
  });
}
