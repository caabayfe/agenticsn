import type { CredentialStore, InstanceProfile } from "@snagentic/core";

// Reads the environment first (CI), then the persistent store; writes go to the persistent
// store only.
export class LayeredCredentialStore implements CredentialStore {
  constructor(
    private readonly environment: CredentialStore,
    private readonly persistent: CredentialStore,
  ) {}

  async read(profile: InstanceProfile): Promise<string | null> {
    return (await this.environment.read(profile)) ?? (await this.persistent.read(profile));
  }

  async write(profile: InstanceProfile, secret: string): Promise<void> {
    await this.persistent.write(profile, secret);
  }

  async remove(profile: InstanceProfile): Promise<boolean> {
    return this.persistent.remove(profile);
  }
}
