import type { InstanceReader } from "../../connection/ports";
import { SnagenticError } from "../../kernel/errors";
import { TableName } from "../../kernel/table-name";
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

// ADR-0012 layer 4: before anything else is asked of a test or production instance, the
// credential must prove it is read-only. One request; development instances skip it.
export async function verifyReadOnlyCredential(
  profile: InstanceProfile,
  reader: InstanceReader,
  signal: AbortSignal,
): Promise<void> {
  if (profile.kind === "development") {
    return;
  }
  const rows = await reader.query(
    {
      table: TableName.parse("sys_user_has_role"),
      query: `user.user_name=${profile.auth.username}^state=active^role.name=snc_read_only`,
      fields: ["sys_id"],
      limit: 1,
    },
    signal,
  );
  if (rows.length === 0) {
    throw new ReadOnlyCredentialRequiredError(
      profile,
      `${profile.auth.username} does not hold snc_read_only`,
    );
  }
}

// ADR-0012 layer 3: operations that change an instance exist only for development instances.
export function ensureDevelopmentInstance(profile: InstanceProfile, operation: string): void {
  if (profile.kind !== "development") {
    throw new DevelopmentInstanceRequiredError(profile, operation);
  }
}
