import { type CredentialStore, credentialVariable, type InstanceProfile } from "@snagentic/core";

// Read-only: CI and servers provide SNAGENTIC_<NAME>_PASSWORD.
export class EnvironmentCredentialStore implements CredentialStore {
  constructor(private readonly environment: Readonly<Record<string, string | undefined>>) {}

  async read(profile: InstanceProfile): Promise<string | null> {
    const value = this.environment[credentialVariable(profile)];
    return value === undefined || value === "" ? null : value;
  }

  async write(): Promise<void> {
    throw new Error("environment variables are read-only");
  }

  async remove(): Promise<boolean> {
    return false;
  }
}
