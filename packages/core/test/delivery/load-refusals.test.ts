import { describe, expect, it } from "bun:test";
import { refusalGroups, refusalOf } from "@snagentic/core";

// fluent/load answers with the update set only: a record the platform skips is named in the
// system log alone (pdi3, 2026-10-23: 36 Performance Analytics records, "permission denied").

const IND = "01e6aa09580b59ea48c0520a57430dbf";

describe("the platform's reason for skipping a loaded record", () => {
  it("is read from its system log message", () => {
    expect(
      refusalOf(
        `Skipping record for table pa_indicators and id ${IND} - permission denied: no thrown error`,
      ),
    ).toEqual({ table: "pa_indicators", sysId: IND, reason: "permission denied" });
    expect(refusalOf("Unable to find saver for update:pa_cubes_x: no thrown error")).toBeNull();
  });
});

describe("what the user is told about skipped records", () => {
  const unit = (table: string, name: string, refused: string | null) => ({
    table,
    name,
    refused,
  });

  it("groups them by table and reason, with the action that unblocks them", () => {
    const groups = refusalGroups(
      [
        unit("pa_indicators", "ACC MTTR", "permission denied"),
        unit("pa_indicators", "ACC Backlog", "permission denied"),
        unit("sys_script", "Rule", "invalid scope"),
        unit("sys_ui_policy", "Fine", null),
      ],
      "admin",
    );
    expect(groups).toEqual([
      {
        table: "pa_indicators",
        reason: "permission denied",
        records: ["ACC MTTR", "ACC Backlog"],
        action:
          "an access rule on pa_indicators does not let admin create these records; Performance Analytics allows it only with a Performance Analytics Premium plugin active: activate com.snc.pa.premium (or declare it in the module's components), then run the same command again",
      },
      {
        table: "sys_script",
        reason: "invalid scope",
        records: ["Rule"],
        action:
          "the instance refused them (invalid scope): fix the cause the system log names, then run the same command again",
      },
    ]);
  });

  it("names the access rules to check for any other table", () => {
    const [group] = refusalGroups([unit("sys_hub_flow", "Flow", "permission denied")], "dev");
    expect(group?.action).toBe(
      "an access rule on sys_hub_flow does not let dev create these records: give dev the role its create rules need, or the plugin a rule's script checks, then run the same command again",
    );
  });
});
