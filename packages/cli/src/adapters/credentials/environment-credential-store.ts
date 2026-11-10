import {
  type CredentialStore,
  credentialVariable,
  INSTANCE_KINDS,
  type InstanceKind,
  type InstanceProfile,
  instanceVariable,
  normalizeInstanceUrl,
  type StoredCredential,
  type TrustedSettings,
} from "@snagentic/core";

// Read-only: CI and servers provide SNAGENTIC_<NAME>_PASSWORD, pinned to an instance by
// SNAGENTIC_<NAME>_URL and SNAGENTIC_<NAME>_KIND (ADR-0020).
export class EnvironmentCredentialStore implements CredentialStore {
  constructor(private readonly environment: Readonly<Record<string, string | undefined>>) {}

  async read(profile: InstanceProfile): Promise<StoredCredential | null> {
    const secret = this.environment[credentialVariable(profile)];
    if (secret === undefined || secret === "") {
      return null;
    }
    return { secret, source: "environment", trusted: this.pinned(profile) };
  }

  async write(): Promise<void> {
    throw new Error("environment variables are read-only");
  }

  async remove(): Promise<boolean> {
    return false;
  }

  private pinned(profile: InstanceProfile): TrustedSettings | null {
    const url = this.environment[instanceVariable(profile, "URL")] ?? "";
    const kind = this.environment[instanceVariable(profile, "KIND")] ?? "";
    if (!isKind(kind)) {
      return null;
    }
    try {
      return { url: normalizeInstanceUrl(url), kind };
    } catch {
      return null;
    }
  }
}

function isKind(value: string): value is InstanceKind {
  return INSTANCE_KINDS.some((kind) => kind === value);
}
