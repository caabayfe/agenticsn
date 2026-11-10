import { TableName } from "../../kernel/table-name";
import { GLOBAL } from "../domain/batch";
import type { SwitchedPreference } from "../ports";
import {
  applyPreference,
  currentPreference,
  type InstanceSession,
  restorePreference,
  restoring,
  userSysId,
} from "./push-steps";

// Settings a development instance needs and no update set may carry to test or production, such
// as ATF test execution (ADR-0047): written in an update set of their own, set to "ignore" once
// they are, with the user's current application and update set put back.

export const DEVELOPMENT_SETTINGS_SET = "snagentic: ATF test execution (development only)";
// The demo modules' settings that --demo turns on (ADR-0049).
export const DEMO_SETTINGS_SET = "snagentic: demo settings (development only)";

const DESCRIPTIONS: Readonly<Record<string, string>> = {
  [DEVELOPMENT_SETTINGS_SET]:
    "Development-only settings snagentic turned on (ADR-0047). Set to ignore: never promote it.",
  [DEMO_SETTINGS_SET]:
    "Demo modules snagentic turned on with --demo (ADR-0049). Set to ignore: never promote it.",
};

export interface AppliedSettings {
  // The properties set, and those the instance does not have (their plugin is not active).
  readonly changed: readonly string[];
  readonly missing: readonly string[];
}

async function propertiesOf(session: InstanceSession, names: readonly string[]) {
  return session.reader.query(
    {
      table: TableName.parse("sys_properties"),
      query: `nameIN${names.join(",")}`,
      fields: ["sys_id", "name", "value"],
      limit: names.length,
    },
    session.signal,
  );
}

// Puts back every preference read before its switch, and sets the update set to ignore, trying
// all of them even after a cancel; the first failure is returned, not thrown.
async function putBack(
  session: InstanceSession,
  switched: readonly SwitchedPreference[],
  set: string,
): Promise<unknown> {
  const cleanup = restoring(session);
  const steps = [
    ...[...switched].reverse().map((preference) => () => restorePreference(cleanup, preference)),
    async () => {
      await cleanup.writer.update("sys_update_set", set, { state: "ignore" }, cleanup.signal);
    },
  ];
  let failure: unknown = null;
  for (const step of steps) {
    await step().catch((error: unknown) => {
      failure ??= error;
    });
  }
  return failure;
}

async function writeApart(
  session: InstanceSession,
  username: string,
  name: string,
  write: () => Promise<void>,
): Promise<void> {
  const user = await userSysId(session, username);
  const set = await session.writer.insert(
    "sys_update_set",
    {
      name,
      application: GLOBAL,
      state: "in progress",
      description: DESCRIPTIONS[name] ?? "",
    },
    session.signal,
  );
  const setId = set["sys_id"] ?? "";
  // Each preference is kept before it is switched, so a switch that fails, or whose outcome is
  // unknown, is put back too.
  const switched: SwitchedPreference[] = [];
  const prefer = async (preference: string, value: string) => {
    const current = await currentPreference(session, user, preference);
    switched.push(current);
    switched[switched.length - 1] = await applyPreference(session, current, value);
  };
  let failure: unknown = null;
  try {
    await prefer("apps.current_app", GLOBAL);
    await prefer("sys_update_set", setId);
    await write();
  } catch (error) {
    failure = error;
  }
  const restoreFailure = await putBack(session, switched, setId);
  // The write's own failure is what the user needs to see first.
  if (failure !== null) throw failure;
  if (restoreFailure !== null) throw restoreFailure;
}

export async function applyDevelopmentSettings(
  session: InstanceSession,
  username: string,
  values: Readonly<Record<string, string>>,
  set: string = DEVELOPMENT_SETTINGS_SET,
): Promise<AppliedSettings> {
  const names = Object.keys(values).sort();
  const rows = await propertiesOf(session, names);
  const found = new Set(rows.map((row) => row["name"] ?? ""));
  const off = rows.filter((row) => row["value"] !== values[row["name"] ?? ""]);
  const missing = names.filter((name) => !found.has(name));
  if (off.length > 0) {
    await writeApart(session, username, set, async () => {
      for (const row of off) {
        const value = values[row["name"] ?? ""] ?? "";
        await session.writer.update(
          "sys_properties",
          row["sys_id"] ?? "",
          { value },
          session.signal,
        );
      }
    });
  }
  return { changed: off.map((row) => row["name"] ?? "").sort(), missing };
}
