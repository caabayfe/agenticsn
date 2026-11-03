import { TableName } from "../../kernel/table-name";
import { GLOBAL } from "../domain/batch";
import { type InstanceSession, restorePreference, switchPreference, userSysId } from "./push-steps";

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
  const switched = [
    await switchPreference(session, user, "apps.current_app", GLOBAL),
    await switchPreference(session, user, "sys_update_set", set["sys_id"] ?? ""),
  ];
  try {
    await write();
  } finally {
    for (const preference of switched.reverse()) await restorePreference(session, preference);
    await session.writer.update(
      "sys_update_set",
      set["sys_id"] ?? "",
      { state: "ignore" },
      session.signal,
    );
  }
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
