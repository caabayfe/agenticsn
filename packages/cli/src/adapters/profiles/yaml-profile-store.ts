import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type AuthSettings,
  clientIdProblem,
  DEFAULT_MAX_AGE_MINUTES,
  INSTANCE_KINDS,
  type InstanceName,
  InstanceName as InstanceNames,
  type InstanceProfile,
  instancePaths,
  maxAgeProblem,
  normalizeInstanceUrl,
  type ProfileStore,
  remoteProblem,
  SnagenticError,
  usernameProblem,
} from "@snagentic/core";
import { parse, stringify } from "yaml";
import { z } from "zod";

class InvalidProfileError extends SnagenticError {
  constructor(path: string, reason: string) {
    super(
      "invalid-profile",
      "precondition",
      `${path} is not a valid instance profile: ${reason}`,
      "fix the file, or remove and add the instance again",
    );
  }
}

// The file format (snake_case) is separate from the domain type on purpose.
const Username = z.string().refine((value) => usernameProblem(value) === null, {
  error: (issue) => usernameProblem(String(issue.input)) ?? "invalid username",
});

const ClientId = z.string().refine((value) => clientIdProblem(value) === null, {
  error: (issue) => clientIdProblem(String(issue.input)) ?? "invalid client id",
});

const ProfileFile = z.object({
  url: z.string(),
  kind: z.enum(INSTANCE_KINDS),
  auth: z.discriminatedUnion("method", [
    z.object({ method: z.literal("basic"), username: Username }),
    z.object({
      method: z.literal("oauth-client-credentials"),
      client_id: ClientId,
      username: Username,
    }),
  ]),
  read_only_acknowledged: z.boolean().default(false),
  // ADR-0052: the git remote holding the team's mirror, and how old it may be before a pull asks
  // the instance.
  shared_mirror: z
    .object({
      remote: z.string().refine((value) => remoteProblem(value) === null, {
        error: (issue) => remoteProblem(String(issue.input)) ?? "invalid remote",
      }),
      max_age_minutes: z
        .number()
        .default(DEFAULT_MAX_AGE_MINUTES)
        .refine((value) => maxAgeProblem(value) === null, {
          error: (issue) => maxAgeProblem(Number(issue.input)) ?? "invalid max age",
        }),
    })
    .optional(),
});

type AuthFile = z.infer<typeof ProfileFile>["auth"];

function authFrom(file: AuthFile): AuthSettings {
  return file.method === "basic"
    ? file
    : { method: file.method, clientId: file.client_id, username: file.username };
}

function authFile(auth: AuthSettings): AuthFile {
  return auth.method === "basic"
    ? { method: auth.method, username: auth.username }
    : { method: auth.method, client_id: auth.clientId, username: auth.username };
}

export class YamlProfileStore implements ProfileStore {
  async list(root: string): Promise<readonly InstanceProfile[]> {
    const directory = join(root, "instances");
    if (!existsSync(directory)) {
      return [];
    }
    const names = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && InstanceNames.is(entry.name))
      .map((entry) => InstanceNames.parse(entry.name));
    const profiles = await Promise.all(names.map((name) => this.read(root, name)));
    return profiles.filter((profile): profile is InstanceProfile => profile !== null);
  }

  async read(root: string, name: InstanceName): Promise<InstanceProfile | null> {
    const path = join(root, instancePaths(name).profile);
    if (!existsSync(path)) {
      return null;
    }
    const file = ProfileFile.safeParse(parse(await readFile(path, "utf8")));
    if (!file.success) {
      throw new InvalidProfileError(path, z.prettifyError(file.error));
    }
    return {
      name,
      url: normalizeInstanceUrl(file.data.url),
      kind: file.data.kind,
      auth: authFrom(file.data.auth),
      readOnlyAcknowledged: file.data.read_only_acknowledged,
      ...(file.data.shared_mirror === undefined
        ? {}
        : {
            sharedMirror: {
              remote: file.data.shared_mirror.remote,
              maxAgeMinutes: file.data.shared_mirror.max_age_minutes,
            },
          }),
    };
  }

  async write(root: string, profile: InstanceProfile): Promise<void> {
    const paths = instancePaths(profile.name);
    await mkdir(join(root, paths.root), { recursive: true });
    const file = {
      url: profile.url,
      kind: profile.kind,
      auth: authFile(profile.auth),
      read_only_acknowledged: profile.readOnlyAcknowledged,
      ...(profile.sharedMirror === undefined
        ? {}
        : {
            shared_mirror: {
              remote: profile.sharedMirror.remote,
              max_age_minutes: profile.sharedMirror.maxAgeMinutes,
            },
          }),
    };
    await writeFile(join(root, paths.profile), stringify(file, { sortMapEntries: true }));
  }

  async remove(root: string, name: InstanceName): Promise<void> {
    await rm(join(root, instancePaths(name).profile), { force: true });
  }
}
