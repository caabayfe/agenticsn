import type { InstanceReader } from "../../connection/ports";
import { SnagenticError } from "../../kernel/errors";
import { SESSION_USER } from "../../kernel/session-user";
import { TableName } from "../../kernel/table-name";
import { IdentityMismatchError, IdentityUnverifiedError } from "../domain/errors";
import type { InstanceProfile } from "../domain/profile";

export class ReadOnlyCredentialRequiredError extends SnagenticError {
  constructor(profile: InstanceProfile, reason: string) {
    super(
      "read-only-credential-required",
      "not-permitted",
      `${profile.name} is a ${profile.kind} instance, and ${reason}; snagentic only uses read-only credentials there`,
      `give ${profile.auth.username} the snc_read_only role (ADR-0012), then check with: snagentic doctor --instance ${profile.name}`,
    );
  }
}

export class ReadOnlyCredentialOnDevelopmentError extends SnagenticError {
  constructor(profile: InstanceProfile) {
    super(
      "read-only-credential-on-development",
      "not-permitted",
      `${profile.auth.username} holds snc_read_only, which marks a test or production credential, but ${profile.name} is a development instance`,
      `check kind in instances/${profile.name}/instance.yaml; if it is right, use a development credential`,
    );
  }
}

export class DevelopmentInstanceRequiredError extends SnagenticError {
  constructor(profile: InstanceProfile, operation: string) {
    super(
      "development-instance-required",
      "not-permitted",
      `${operation} changes the instance, and ${profile.name} is a ${profile.kind} instance`,
      "only development instances can be changed (ADR-0012); use a development instance",
    );
  }
}

async function holdsReadOnly(reader: InstanceReader, signal: AbortSignal): Promise<boolean> {
  const rows = await reader.query(
    {
      table: TableName.parse("sys_user_has_role"),
      query: `user=${SESSION_USER}^state=active^role.name=snc_read_only`,
      fields: ["sys_id"],
      limit: 1,
    },
    signal,
  );
  return rows.length > 0;
}

function notReadOnly(profile: InstanceProfile): ReadOnlyCredentialRequiredError {
  return new ReadOnlyCredentialRequiredError(
    profile,
    `${profile.auth.username} does not hold snc_read_only`,
  );
}

// ADR-0012 layer 4: before anything else is asked of a test or production instance, the
// credential must prove it is read-only. One request; development instances skip it.
export async function verifyReadOnlyCredential(
  profile: InstanceProfile,
  reader: InstanceReader,
  signal: AbortSignal,
): Promise<void> {
  if (profile.kind !== "development" && !(await holdsReadOnly(reader, signal))) {
    throw notReadOnly(profile);
  }
}

// ADR-0021: the instance must sign in the user instance.yaml names, so lists, labels and
// exports show the real one. One request, at login and in doctor only.
export async function verifySessionIdentity(
  profile: InstanceProfile,
  reader: InstanceReader,
  signal: AbortSignal,
): Promise<void> {
  const rows = await reader.query(
    {
      table: TableName.parse("sys_user"),
      query: `sys_id=${SESSION_USER}`,
      fields: ["user_name"],
      limit: 1,
    },
    signal,
  );
  const actual = rows[0]?.["user_name"] ?? "";
  if (actual === "") {
    throw new IdentityUnverifiedError(profile.name);
  }
  if (actual !== profile.auth.username) {
    throw new IdentityMismatchError(profile.name, profile.auth.username, actual);
  }
}

// ADR-0020: at login, the credential must match the kind both ways, so an edited kind is
// refused even when a person types the password.
export async function verifyCredentialMatchesKind(
  profile: InstanceProfile,
  reader: InstanceReader,
  signal: AbortSignal,
): Promise<void> {
  const readOnly = await holdsReadOnly(reader, signal);
  if (profile.kind === "development" && readOnly) {
    throw new ReadOnlyCredentialOnDevelopmentError(profile);
  }
  if (profile.kind !== "development" && !readOnly) {
    throw notReadOnly(profile);
  }
}

// ADR-0012 layer 3: operations that change an instance exist only for development instances.
export function ensureDevelopmentInstance(profile: InstanceProfile, operation: string): void {
  if (profile.kind !== "development") {
    throw new DevelopmentInstanceRequiredError(profile, operation);
  }
}
