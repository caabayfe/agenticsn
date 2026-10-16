import {
  type CredentialStore,
  credentialVariable,
  INSTANCE_KINDS,
  type InstanceKind,
  type InstanceProfile,
  normalizeInstanceUrl,
  type StoredCredential,
  type TrustedSettings,
} from "@snagentic/core";

// Read-only: CI and servers provide SNAGENTIC_<NAME>_PASSWORD, pinned to an instance by
// SNAGENTIC_<NAME>_URL and SNAGENTIC_<NAME>_KIND (ADR-0020).
export class EnvironmentCredentialStore implements CredentialStore {
  constructor(private readonly environment: Readonly<Record<string, string | undefined>>) {}

  async read(profile: InstanceProfile): Promise<StoredCredential | null> {
    const variable = credentialVariable(profile);
    const secret = this.environment[variable];
    if (secret === undefined || secret === "") {
      return null;
    }
    const prefix = variable.replace(/_PASSWORD$/, "");
    return { secret, source: "environment", trusted: this.pinned(prefix) };
  }

  async write(): Promise<void> {
    throw new Error("environment variables are read-only");
  }

  async remove(): Promise<boolean> {
    return false;
  }

  private pinned(prefix: string): TrustedSettings | null {
    const url = this.environment[`${prefix}_URL`] ?? "";
    const kind = this.environment[`${prefix}_KIND`] ?? "";
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
