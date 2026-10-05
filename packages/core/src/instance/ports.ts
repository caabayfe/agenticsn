import type { InstanceName } from "../kernel/instance-name";
import type { InstanceProfile } from "./domain/profile";

// Profiles live in the workspace (instances/<name>/instance.yaml); `root` is its path.
export interface ProfileStore {
  list(root: string): Promise<readonly InstanceProfile[]>;
  read(root: string, name: InstanceName): Promise<InstanceProfile | null>;
  write(root: string, profile: InstanceProfile): Promise<void>;
  remove(root: string, name: InstanceName): Promise<void>;
}

// Secrets never live in the workspace: OS keychain or environment variables only.
export interface CredentialStore {
  read(profile: InstanceProfile): Promise<string | null>;
  write(profile: InstanceProfile, secret: string): Promise<void>;
  remove(profile: InstanceProfile): Promise<boolean>;
}
