import type { InstanceReader, Row } from "../../connection/ports";
import {
  credentialAccount,
  credentialVariables,
  type InstanceProfile,
} from "../../instance/domain/profile";
import { type StoredCredential, trustProblems, untrustedHint } from "../../instance/domain/trust";
import { SnagenticError } from "../../kernel/errors";
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

async function connect(
  profile: InstanceProfile,
  reader: InstanceReader,
  signal: AbortSignal,
): Promise<Row | Check> {
  try {
    const rows = await reader.query(
      {
        table: TableName.parse("sys_user"),
        query: `user_name=${profile.auth.username}`,
        fields: ["sys_id", "sys_updated_on"],
        limit: 1,
      },
      signal,
    );
    return (
      rows[0] ??
      check(
        "connection",
        "fail",
        `authenticated, but cannot read user ${profile.auth.username}`,
        "grant the user read access to its own sys_user record",
      )
    );
  } catch (error) {
    return failure("connection", error);
  }
}

// Only the roles that matter are requested, so a user with hundreds of roles can never push
// the answer past the page limit.
const RELEVANT_ROLES = ["admin", "snc_read_only"] as const;

async function roles(
  profile: InstanceProfile,
  user: Row,
  reader: InstanceReader,
  signal: AbortSignal,
): Promise<Check> {
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
    if (profile.kind !== "development" && !held.has("snc_read_only")) {
      return check(
        "roles",
        "warn",
        detail,
        "a test or production credential should have snc_read_only (ADR-0012)",
      );
    }
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
  const user = await connect(profile, reader, signal);
  if ("status" in user) {
    return [credentials, user as Check, ...skipped(2)];
  }
  const connection = check("connection", "ok", `${profile.url} as ${profile.auth.username}`);
  const results = [
    credentials,
    connection,
    await roles(profile, user, reader, signal),
    await timestamps(user, reader, signal),
  ];
  const stats = reader.stats();
  const load = `${stats.requests} requests, semaphore wait ${stats.semaphoreWaitMs} ms, concurrency ${stats.concurrencyLimit}`;
  return [...results, check("load", "ok", load)];
}
