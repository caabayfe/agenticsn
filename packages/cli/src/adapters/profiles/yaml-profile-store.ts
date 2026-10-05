import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  INSTANCE_KINDS,
  type InstanceName,
  InstanceName as InstanceNames,
  type InstanceProfile,
  instancePaths,
  normalizeInstanceUrl,
  type ProfileStore,
  SnagenticError,
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
const ProfileFile = z.object({
  url: z.string(),
  kind: z.enum(INSTANCE_KINDS),
  auth: z.object({ method: z.literal("basic"), username: z.string().min(1) }),
  read_only_acknowledged: z.boolean().default(false),
});

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
      auth: file.data.auth,
      readOnlyAcknowledged: file.data.read_only_acknowledged,
    };
  }

  async write(root: string, profile: InstanceProfile): Promise<void> {
    const paths = instancePaths(profile.name);
    await mkdir(join(root, paths.root), { recursive: true });
    const file = {
      url: profile.url,
      kind: profile.kind,
      auth: { method: profile.auth.method, username: profile.auth.username },
      read_only_acknowledged: profile.readOnlyAcknowledged,
    };
    await writeFile(join(root, paths.profile), stringify(file, { sortMapEntries: true }));
  }

  async remove(root: string, name: InstanceName): Promise<void> {
    await rm(join(root, instancePaths(name).profile), { force: true });
  }
}
