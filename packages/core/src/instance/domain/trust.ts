import { credentialVariable, type InstanceKind, type InstanceProfile } from "./profile";

// ADR-0020: what a person confirmed when storing the secret. instance.yaml can be edited by
// anyone; the secret is released only while the profile still matches.
export interface TrustedSettings {
  readonly url: string;
  readonly kind: InstanceKind;
}

export type CredentialSource = "keychain" | "environment";

export interface StoredCredential {
  readonly secret: string;
  readonly source: CredentialSource;
  // null: stored without settings (an earlier version, or environment variables missing).
  readonly trusted: TrustedSettings | null;
}

export function trustProblems(
  profile: InstanceProfile,
  trusted: TrustedSettings | null,
): readonly string[] {
  if (trusted === null) {
    return ["the stored credential does not record which instance it is for"];
  }
  const problems: string[] = [];
  if (trusted.url !== profile.url) {
    problems.push(`url is ${profile.url}, but was ${trusted.url} when the password was stored`);
  }
  if (trusted.kind !== profile.kind) {
    problems.push(`kind is ${profile.kind}, but was ${trusted.kind} when the password was stored`);
  }
  return problems;
}

export function trustedSecret(
  profile: InstanceProfile,
  credential: StoredCredential | null,
): string | null {
  return credential !== null && trustProblems(profile, credential.trusted).length === 0
    ? credential.secret
    : null;
}

export function untrustedHint(profile: InstanceProfile, source: CredentialSource): string {
  if (source === "environment") {
    const prefix = credentialVariable(profile).replace(/_PASSWORD$/, "");
    return `set ${prefix}_URL and ${prefix}_KIND to the instance's url and kind (ADR-0020)`;
  }
  return (
    `if a person made this change, run: snagentic auth login ${profile.name}; ` +
    `otherwise restore the file: git checkout -- instances/${profile.name}/instance.yaml`
  );
}
