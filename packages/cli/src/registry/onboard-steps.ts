import {
  answerOf,
  createProfile,
  getInstance,
  type InstanceAnswer,
  type InstanceKind,
  InstanceName,
  InvalidInputError,
  login,
  type OnboardSteps,
  profileForLogin,
  rememberIdentity,
  secretName,
  trustedSecret,
  verifySessionIdentity,
  WorkspaceNotFoundError,
} from "@snagentic/core";
import { doctor } from "./doctor";
import { runUseCase } from "./execute";
import { init, resolvePath } from "./init";
import { type CallUseCase, callerFor } from "./install-steps";
import { instanceAdd } from "./instance-add";
import { integrate } from "./integrate";
import { pull } from "./pull";
import type { RunControl, UseCaseContext } from "./use-case";
import { workspaceRoot } from "./workspace-root";

export interface OnboardInput {
  readonly name: string;
  readonly url: string;
  readonly username: string;
  readonly kind: InstanceKind;
  readonly acknowledgeReadOnly: boolean;
  readonly clientId?: string | undefined;
  readonly path?: string | undefined;
}

// What the steps share: the workspace once the first step has found or made it.
interface Session {
  readonly input: OnboardInput;
  readonly name: InstanceName;
  readonly context: UseCaseContext;
  readonly run: RunControl;
  root: string | null;
}

const rootOf = (session: Session): string => session.root ?? "";

// The nested commands run in the workspace this run found or created, whatever the folder it
// was started from.
const contextIn = (session: Session): UseCaseContext => ({
  ...session.context,
  host: { ...session.context.host, workspaceOverride: rootOf(session) },
});

const callIn =
  (session: Session): CallUseCase =>
  (useCase, args) =>
    callerFor(contextIn(session), session.run)(useCase, args);

async function foundWorkspace(session: Session): Promise<string | null> {
  const { input, context } = session;
  if (input.path !== undefined) {
    const given = resolvePath(input.path, context.host);
    return (await context.workspaces.readManifest(given)) === null ? null : given;
  }
  try {
    return await workspaceRoot(context);
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) {
      return null;
    }
    throw error;
  }
}

async function workspaceStep(session: Session): Promise<"done" | "already"> {
  const found = await foundWorkspace(session);
  if (found !== null) {
    session.root = found;
    return "already";
  }
  const { input, context, run } = session;
  run.progress({ message: "creating the workspace" });
  const where = input.path === undefined ? { name: input.name } : { path: input.path };
  session.root = (await runUseCase(init, where, context, run)).root;
  return "done";
}

async function profileStep(session: Session): Promise<"done" | "already"> {
  const { input, name, context, run } = session;
  const wanted = createProfile({
    name,
    url: input.url,
    username: input.username,
    kind: input.kind,
    acknowledgeReadOnly: input.acknowledgeReadOnly,
    ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
  });
  const existing = await context.profiles.read(rootOf(session), name);
  if (existing === null) {
    run.progress({ message: `adding the profile ${name}` });
    // Not through callIn: its progress lines are the install's, and "add" there means a module.
    await runUseCase(instanceAdd, { ...input, name }, contextIn(session), run);
    return "done";
  }
  if (existing.url !== wanted.url || existing.kind !== wanted.kind) {
    throw new InvalidInputError(
      `the profile "${name}" already names ${existing.url} (${existing.kind}); use another name, or remove it first: snagentic instance remove ${name}`,
    );
  }
  return "already";
}

// A stored credential is checked with one read; otherwise the secret is asked for, and kept
// only once the instance accepted it (the same login `auth login` does).
async function signInStep(session: Session): Promise<InstanceAnswer> {
  const { name, context, run } = session;
  const root = rootOf(session);
  const profile = profileForLogin(await getInstance(root, name, context.profiles), undefined);
  run.progress({ message: `checking ${profile.url}` });
  const stored = trustedSecret(profile, await context.credentials.read(profile));
  if (stored !== null) {
    const reader = context.connections.open(profile, stored);
    return answerOf(name, () => verifySessionIdentity(profile, reader, run.signal));
  }
  const secret = await context.secrets.read(
    `${secretName(profile)} for ${profile.auth.username}: `,
  );
  const reader = context.connections.open(profile, secret);
  return answerOf(name, async () => {
    await login(profile, secret, context.credentials, reader, run.signal);
    await rememberIdentity(root, profile, context.identities);
  });
}

// The steps of onboarding as the real commands do them (ADR-0056). Each runs through the same
// checks as any other call.
export function onboardSteps(
  input: OnboardInput,
  context: UseCaseContext,
  run: RunControl,
): OnboardSteps & { readonly root: () => string | null } {
  const session: Session = {
    input,
    name: InstanceName.parse(input.name),
    context,
    run,
    root: null,
  };
  const instance = session.name;
  return {
    root: () => session.root,
    workspace: () => workspaceStep(session),
    profile: () => profileStep(session),
    signIn: () => signInStep(session),
    async doctor() {
      const result = await callIn(session)(doctor, { instance });
      return {
        failed: result.checks.filter((check) => check.status === "fail").map((check) => check.name),
      };
    },
    async pull() {
      run.progress({
        message: "the first pull of a large instance takes a while, and resumes if it stops",
      });
      await callIn(session)(pull, { instance });
    },
    async integrate() {
      await callIn(session)(integrate, { instance });
    },
  };
}
