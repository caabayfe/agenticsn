import type { InstanceReader, Row } from "../../connection/ports";
import { ReadOnlyCredentialRequiredError, verifyReadOnlyCredential } from "../../instance";
import { actingAs, identityMismatch } from "../../instance/domain/identity";
import {
  credentialAccount,
  credentialVariables,
  type InstanceProfile,
} from "../../instance/domain/profile";
import { type StoredCredential, trustProblems, untrustedHint } from "../../instance/domain/trust";
import { SnagenticError } from "../../kernel/errors";
import { SESSION_USER } from "../../kernel/session-user";
import { TableName } from "../../kernel/table-name";
import type { Check, CheckStatus } from "../domain/check";

const NAMES = ["credentials", "connection", "roles", "timestamps", "load"] as const;
type CheckName = (typeof NAMES)[number];

function check(
  name: CheckName,
  status: CheckStatus,
  detail: string,
  hint: string | null = null,
): Check {
  return { name, status, detail, hint };
}

function skipped(from: number): Check[] {
  return NAMES.slice(from).map((name) =>
    check(name, "unavailable", "not checked: an earlier check failed"),
  );
}

function failure(name: CheckName, error: unknown): Check {
  if (error instanceof SnagenticError) {
    return check(name, "fail", error.message, error.hint);
  }
  throw error;
}

// ADR-0021: the signed-in user, which must be the one instance.yaml names.
async function connect(
  profile: InstanceProfile,
  reader: InstanceReader,
  signal: AbortSignal,
): Promise<Row | Check> {
  try {
    const rows = await reader.query(
      {
        table: TableName.parse("sys_user"),
        query: `sys_id=${SESSION_USER}`,
        fields: ["sys_id", "user_name", "sys_updated_on"],
        limit: 1,
      },
      signal,
    );
    const user = rows[0];
    if (user === undefined) {
      return check(
        "connection",
        "fail",
        "authenticated, but cannot read the signed-in user",
        "grant the user read access to its own sys_user record",
      );
    }
    const actual = user["user_name"] ?? "";
    if (actual !== profile.auth.username) {
      const mismatch = identityMismatch(profile, actual);
      return check("connection", "fail", mismatch.message, mismatch.hint);
    }
    return user;
  } catch (error) {
    return failure("connection", error);
  }
}

// Only the roles that matter are requested, so a user with hundreds of roles can never push
// the answer past the page limit.
const RELEVANT_ROLES = ["admin", "snc_read_only"] as const;

async function roles(user: Row, reader: InstanceReader, signal: AbortSignal): Promise<Check> {
  try {
    const rows = await reader.query(
      {
        table: TableName.parse("sys_user_has_role"),
        query: `user=${user["sys_id"]}^state=active^role.nameIN${RELEVANT_ROLES.join(",")}`,
        fields: ["role.name"],
        limit: 10,
      },
      signal,
    );
    const held = new Set(rows.map((row) => row["role.name"] ?? ""));
    const detail = `has ${RELEVANT_ROLES.filter((role) => held.has(role)).join(" and ") || `neither ${RELEVANT_ROLES.join(" nor ")}`}`;
    return held.has("admin")
      ? check("roles", "ok", detail)
      : check(
          "roles",
          "warn",
          detail,
          "a full sync needs read access to all metadata; admin is the simplest",
        );
  } catch (error) {
    return failure("roles", error);
  }
}

// ADR-0016: incremental sync relies on encoded queries reading timestamps as raw UTC.
async function timestamps(user: Row, reader: InstanceReader, signal: AbortSignal): Promise<Check> {
  try {
    const rows = await reader.query(
      {
        table: TableName.parse("sys_user"),
        query: `sys_id=${user["sys_id"]}^sys_updated_on=${user["sys_updated_on"]}`,
        fields: ["sys_id"],
        limit: 1,
      },
      signal,
    );
    return rows.length === 1
      ? check("timestamps", "ok", "encoded queries read timestamps as UTC")
      : check(
          "timestamps",
          "fail",
          "encoded queries do not read timestamps as UTC",
          "incremental sync would be unreliable; please report this instance's configuration",
        );
  } catch (error) {
    return failure("timestamps", error);
  }
}

// ADR-0012 layer 4: a test or production credential proves it is read-only before anything
// else is asked. One that does not is the finding, and the instance is not called again.
async function refusedAccess(
  profile: InstanceProfile,
  reader: InstanceReader,
  signal: AbortSignal,
): Promise<Check[] | null> {
  try {
    await verifyReadOnlyCredential(profile, reader, signal);
    return null;
  } catch (error) {
    if (error instanceof ReadOnlyCredentialRequiredError) {
      return [
        check("connection", "unavailable", "not checked: the credential is not read-only"),
        check("roles", "fail", error.message, error.hint),
        ...skipped(3),
      ];
    }
    return [failure("connection", error), ...skipped(2)];
  }
}

export async function runInstanceChecks(
  profile: InstanceProfile,
  credential: StoredCredential | null,
  reader: InstanceReader,
  signal: AbortSignal,
): Promise<Check[]> {
  if (credential === null) {
    const hint = `run: snagentic auth login ${profile.name} (in CI, set ${credentialVariables(profile)})`;
    return [
      check("credentials", "fail", `no credentials for ${credentialAccount(profile)}`, hint),
      ...skipped(1),
    ];
  }
  // ADR-0020: an untrusted secret is never sent, so nothing else can be checked.
  const problems = trustProblems(profile, credential.trusted);
  if (problems.length > 0) {
    const hint = untrustedHint(profile, credential.source);
    return [check("credentials", "fail", problems.join("; "), hint), ...skipped(1)];
  }
  const credentials = check("credentials", "ok", `found for ${credentialAccount(profile)}`);
  const refused = await refusedAccess(profile, reader, signal);
  if (refused !== null) {
    return [credentials, ...refused];
  }
  const user = await connect(profile, reader, signal);
  if ("status" in user) {
    return [credentials, user as Check, ...skipped(2)];
  }
  const connection = check("connection", "ok", `${profile.url} as ${actingAs(profile)}`);
  const results = [
    credentials,
    connection,
    await roles(user, reader, signal),
    await timestamps(user, reader, signal),
  ];
  const stats = reader.stats();
  const load = `${stats.requests} requests, semaphore wait ${stats.semaphoreWaitMs} ms, concurrency ${stats.concurrencyLimit}`;
  return [...results, check("load", "ok", load)];
}
