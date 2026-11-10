import type { InstanceName } from "../kernel/instance-name";
import type { InstanceProfile } from "./domain/profile";
import type { StoredCredential } from "./domain/trust";

// Profiles live in the workspace (instances/<name>/instance.yaml); `root` is its path.
export interface ProfileStore {
  list(root: string): Promise<readonly InstanceProfile[]>;
  read(root: string, name: InstanceName): Promise<InstanceProfile | null>;
  write(root: string, profile: InstanceProfile): Promise<void>;
  remove(root: string, name: InstanceName): Promise<void>;
}

// Secrets never live in the workspace: OS keychain or environment variables only. A secret is
// stored together with the profile's url and kind (ADR-0020).
export interface CredentialStore {
  read(profile: InstanceProfile): Promise<StoredCredential | null>;
  write(profile: InstanceProfile, secret: string): Promise<void>;
  remove(profile: InstanceProfile): Promise<boolean>;
}

// ADR-0054: the user this clone signs in as, set by auth login --username. It lives outside the
// workspace, in the OS keychain, bound to the profile's url and kind like the secret (ADR-0020);
// read returns null when there is none, or when the profile no longer matches.
export interface IdentityStore {
  read(root: string, profile: InstanceProfile): Promise<string | null>;
  write(root: string, profile: InstanceProfile, username: string): Promise<void>;
  remove(root: string, profile: InstanceProfile): Promise<boolean>;
}

// The sources of the username, before instance.yaml (ADR-0054 item 1).
export interface UsernameSources {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly clone: IdentityStore;
}
