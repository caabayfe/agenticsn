import { AsyncEntry } from "@napi-rs/keyring";
import {
  checkedUsername,
  type IdentityStore,
  INSTANCE_KINDS,
  type InstanceProfile,
  identityAccount,
  SnagenticError,
} from "@snagentic/core";
import { z } from "zod";
import type { CreateKeychainEntry, KeychainEntry } from "./keychain-credential-store";

const SERVICE = "snagentic";

// ADR-0054: like the secret's item (ADR-0020), the identity is stored with the url and kind it
// was set for, and used only while the profile still names them.
const BoundIdentity = z.object({
  snagentic: z.literal(1),
  identity: z.string(),
  url: z.string(),
  kind: z.enum(INSTANCE_KINDS),
});

function parseItem(value: string, profile: InstanceProfile): string | null {
  let json: unknown = null;
  try {
    json = JSON.parse(value);
  } catch {
    return null;
  }
  const bound = BoundIdentity.safeParse(json);
  if (!bound.success || bound.data.url !== profile.url || bound.data.kind !== profile.kind) {
    return null;
  }
  try {
    return checkedUsername(bound.data.identity, "the stored identity");
  } catch {
    return null;
  }
}

class IdentityNotStoredError extends SnagenticError {
  constructor(reason: string) {
    super(
      "keychain-unavailable",
      "precondition",
      `the OS keychain could not store this clone's identity: ${reason}`,
      "set SNAGENTIC_<NAME>_USERNAME with the other credential variables instead (recommended for servers and CI)",
    );
  }
}

// This clone's identity: service "snagentic", account "identity:<name>@<host>:<workspace root>".
export class KeychainIdentityStore implements IdentityStore {
  constructor(
    private readonly createEntry: CreateKeychainEntry = (service, account) =>
      new AsyncEntry(service, account),
  ) {}

  async read(root: string, profile: InstanceProfile): Promise<string | null> {
    try {
      const value = await this.entry(root, profile).getPassword();
      return value === undefined || value === null || value === ""
        ? null
        : parseItem(value, profile);
    } catch {
      // No keychain (e.g. a headless Linux server): the username comes from elsewhere.
      return null;
    }
  }

  async write(root: string, profile: InstanceProfile, username: string): Promise<void> {
    const item = { snagentic: 1, identity: username, url: profile.url, kind: profile.kind };
    try {
      await this.entry(root, profile).setPassword(JSON.stringify(item));
    } catch (error) {
      throw new IdentityNotStoredError(error instanceof Error ? error.message : String(error));
    }
  }

  async remove(root: string, profile: InstanceProfile): Promise<boolean> {
    try {
      return await this.entry(root, profile).deletePassword();
    } catch {
      return false;
    }
  }

  private entry(root: string, profile: InstanceProfile): KeychainEntry {
    return this.createEntry(SERVICE, identityAccount(root, profile));
  }
}
