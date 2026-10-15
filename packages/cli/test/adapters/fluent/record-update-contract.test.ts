import { describe, expect, it } from "bun:test";
import { type RecordUpdate, recordUpdateName, recordUpdateXml } from "@snagentic/core";
import { buildWithSdk, explicitKey, SCOPE, SDK_BUILD_TIMEOUT } from "../../support/sdk-contract";

// ADR-0030: a record of a class the platform does not record (a scheduled job) is loaded as the
// update the embedded SDK's Record() builds. This builds the same record with the SDK, its sys_id
// pinned, and requires the same bytes.

const JOB: RecordUpdate = {
  table: "sysauto_script",
  sysId: "9d3ecd5a5e9d41b7b05708b0588de66a",
  fields: {
    name: "Nightly <cleanup> & more",
    run_type: "daily",
    run_time: "1970-01-01 06:00:00",
    active: "false",
    script: "gs.info('x');\nvar a = 1 < 2;",
    run_as: "6816f79cc0a8016401c5a33be04be441",
    conditional: "false",
    condition: "",
  },
};

const SOURCE = `Record({ $id: Now.ID['job'], table: 'sysauto_script', data: {
  name: 'Nightly <cleanup> & more', run_type: 'daily', run_time: '1970-01-01 06:00:00',
  active: false, script: "gs.info('x');\\nvar a = 1 < 2;", run_as: '6816f79cc0a8016401c5a33be04be441',
  conditional: false, condition: '',
} })`;

describe("one record's update, against the embedded SDK (ADR-0030)", () => {
  it(
    "writes what the SDK's Record() builds, byte for byte",
    async () => {
      const { outcome, built } = await buildWithSdk(
        "import { Record } from '@servicenow/sdk/core'",
        SOURCE,
        [],
        [explicitKey("job", JOB.table, JOB.sysId)],
      );
      expect(outcome).toMatchObject({ success: true });
      expect(recordUpdateXml(JOB, SCOPE)).toBe(built(recordUpdateName(JOB)));
    },
    SDK_BUILD_TIMEOUT,
  );
});
