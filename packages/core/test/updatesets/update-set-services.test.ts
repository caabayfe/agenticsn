import { describe, expect, it } from "bun:test";
import {
  completeUpdateSets,
  exportId,
  exportUpdateSet,
  KeysetPager,
  listUpdateSets,
  openUpdateSets,
  type Row,
  showUpdateSet,
  updateSetCollisions,
} from "@snagentic/core";
import { fakeInstance } from "../support/fake-instance";

const LIVE = new AbortController().signal;
const NOW = new Date("2026-10-06T12:00:00Z");
const ALICE = "a1000000000000000000000000000001";
const BOB = "b2000000000000000000000000000002";
const OLD = "c3000000000000000000000000000003";
const DEFAULT = "d4000000000000000000000000000004";

const set = (
  sys_id: string,
  name: string,
  state: string,
  updated: string,
  extra: Row = {},
): Row => ({
  sys_id,
  name,
  state,
  application: "global",
  is_default: "false",
  description: "",
  sys_created_by: "alice",
  sys_updated_on: updated,
  ...extra,
});
const update = (
  sys_id: string,
  updateSet: string,
  name: string,
  recorded: string,
  by = "alice",
): Row => ({
  sys_id,
  update_set: updateSet,
  name,
  type: "Business Rule",
  target_name: "VIP flag",
  action: "INSERT_OR_UPDATE",
  table: "",
  application: "global",
  payload: `<?xml version="1.0" encoding="UTF-8"?><record_update table="sys_script"/>`,
  sys_recorded_at: recorded,
  sys_updated_by: by,
  sys_updated_on: `2026-10-0${recorded} 10:00:00`,
});
const dictionary = (table: string, references: string[], plain: string[]): Row[] => [
  ...references.map((element) => ({
    sys_id: `${table}.${element}`,
    name: table,
    element,
    internal_type: "reference",
  })),
  ...plain.map((element) => ({
    sys_id: `${table}.${element}`,
    name: table,
    element,
    internal_type: "string",
  })),
];

// The classes the export reads to withhold secrets (spec 012, B-04): a credential class with a
// subclass, and a class whose parent this user can't read.
const classId = (n: string) => n.repeat(32);
const klass = (sys_id: string, name: string, super_class = ""): Row => ({
  sys_id,
  name,
  super_class,
});
const CLASSES: Row[] = [
  klass(classId("1"), "sys_metadata"),
  klass(classId("2"), "sys_script", classId("1")),
  klass(classId("3"), "sys_properties", classId("1")),
  klass(classId("4"), "sys_data_source", classId("1")),
  klass(classId("5"), "discovery_credentials"),
  klass(classId("6"), "ssh_credentials", classId("5")),
  klass(classId("7"), "ssh_private_key_credentials", classId("6")),
  klass(classId("8"), "x_hidden_child", classId("9")),
];

function instance() {
  const data: Record<string, Row[]> = {
    sys_update_set: [
      set(ALICE, "Alice's work", "in progress", "2026-10-05 10:00:00"),
      set(BOB, "Bob's work", "in progress", "2026-10-04 10:00:00", { sys_created_by: "bob" }),
      set(OLD, "Shipped", "complete", "2026-01-01 10:00:00"),
      set(DEFAULT, "Default", "in progress", "2026-06-01 10:00:00", { is_default: "true" }),
    ],
    sys_update_xml: [
      update("u1", ALICE, "sys_script_1", "1"),
      update("u2", BOB, "sys_script_1", "2", "bob"),
      update("u3", ALICE, "sys_script_2", "3"),
      update("u4", DEFAULT, "sys_script_2", "4"),
      update("u5", OLD, "sys_script_9", "5"),
      {
        ...update("u6", OLD, "sys_properties_1", "6"),
        target_name: "x.api_key",
        payload: `<record_update table="sys_properties"><sys_properties><name>x.api_key</name><value>s3cret</value></sys_properties></record_update>`,
      },
    ],
    sys_scope: [{ sys_id: "global", name: "Global", scope: "global", version: "" }],
    sys_db_object: CLASSES,
    sys_dictionary: [
      ...dictionary(
        "sys_remote_update_set",
        ["application"],
        ["name", "remote_sys_id", "state", "sys_id"],
      ),
      ...dictionary(
        "sys_update_xml",
        ["application", "remote_update_set", "update_set"],
        ["name", "payload", "sys_id", "sys_recorded_at"],
      ),
    ],
  };
  const fake = fakeInstance(data);
  return {
    fake,
    deps: { pager: new KeysetPager(fake.reader), statistics: fake.reader, now: () => NOW },
  };
}

describe("update set services", () => {
  it("lists open sets and those changed recently, newest first, with their update counts", async () => {
    const { deps } = instance();
    const sets = await listUpdateSets(deps, 30, LIVE);
    expect(
      sets.map((s) => [s.name, s.state, s.application, s.owner, s.updates, s.isDefault]),
    ).toEqual([
      ["Alice's work", "in progress", "Global", "alice", 2, false],
      ["Bob's work", "in progress", "Global", "bob", 1, false],
      ["Default", "in progress", "Global", "alice", 1, true],
    ]);
    expect((await listUpdateSets(deps, 365, LIVE)).map((s) => s.name)).toContain("Shipped");
  });

  it("shows one set's updates without reading their payloads", async () => {
    const { deps, fake } = instance();
    const { updateSet, updates } = await showUpdateSet(deps, "pdi", ALICE, LIVE);
    expect(updateSet.name).toBe("Alice's work");
    expect(updates.map((u) => u.name)).toEqual(["sys_script_1", "sys_script_2"]);
    expect(fake.queries.every((query) => query.fields !== "all")).toBe(true);
  });

  it("explains an update set that does not exist", async () => {
    const { deps } = instance();
    await expect(
      showUpdateSet(deps, "pdi", "e5000000000000000000000000000005", LIVE),
    ).rejects.toMatchObject({
      code: "update-set-not-found",
    });
  });

  it("finds records held by two open sets, not those in the default set", async () => {
    const { deps } = instance();
    const report = await updateSetCollisions(deps, LIVE);
    expect(report.openSets).toBe(3);
    expect(report.collisions.map((c) => [c.record, c.holders.map((h) => h.updateSetName)])).toEqual(
      [["sys_script_1", ["Alice's work", "Bob's work"]]],
    );
    expect(report.defaultSetRecords).toBe(1);
  });

  it("exports a set as a loaded remote update set with its updates, in recorded order", async () => {
    const { deps } = instance();
    const exported = await exportUpdateSet(deps, "pdi", ALICE, "admin", LIVE);
    expect(exported).toMatchObject({ sysId: ALICE, name: "Alice's work", updates: 2 });
    const xml = exported.xml;
    expect(xml).toStartWith(
      '<?xml version="1.0" encoding="UTF-8"?>\n<unload unload_date="2026-10-06 12:00:00">\n<sys_remote_update_set action="INSERT_OR_UPDATE">',
    );
    expect(xml).toContain(`<remote_sys_id>${ALICE}</remote_sys_id>`);
    expect(xml).toContain("<state>loaded</state>");
    expect(xml.indexOf(`<sys_id>${exportId("u1")}</sys_id>`)).toBeLessThan(
      xml.indexOf(`<sys_id>${exportId("u3")}</sys_id>`),
    );
    expect(xml).toContain(
      `<remote_update_set display_value="Alice's work">${exportId(ALICE)}</remote_update_set>`,
    );
    expect(xml).toContain(
      '<payload><![CDATA[<?xml version="1.0" encoding="UTF-8"?><record_update table="sys_script"/>]]></payload>',
    );
    expect(xml).not.toContain("type>");
    expect(xml).toEndWith("</sys_update_xml>\n</unload>\n");
  });

  it("withholds credential subclasses, password-typed fields and classes it can't trace", async () => {
    const { fake, deps } = instance();
    const updates = fake.tables["sys_update_xml"] ?? [];
    const withSecret = (sys_id: string, name: string, payload: string): Row => ({
      ...update(sys_id, OLD, name, "7"),
      target_name: name,
      payload,
    });
    updates.push(
      withSecret(
        "u7",
        "ssh_key",
        '<record_update table="ssh_private_key_credentials"><ssh_private_key_credentials><ssh_private_key>k3y</ssh_private_key></ssh_private_key_credentials></record_update>',
      ),
      withSecret(
        "u8",
        "hr_source",
        '<record_update table="sys_data_source"><sys_data_source><jdbc_password>pw</jdbc_password></sys_data_source></record_update>',
      ),
      withSecret(
        "u9",
        "hidden",
        '<record_update table="x_hidden_child"><x_hidden_child><name>n</name></x_hidden_child></record_update>',
      ),
    );
    fake.tables["sys_dictionary"]?.push({
      sys_id: "d-jdbc",
      name: "sys_data_source",
      element: "jdbc_password",
      internal_type: "password2",
    });
    const exported = await exportUpdateSet(deps, "pdi", OLD, "admin", LIVE);
    expect(exported.updates).toBe(1);
    expect(exported.xml).not.toContain("k3y");
    expect(exported.withheld.map((w) => [w.name, w.reason])).toEqual([
      ["sys_properties_1", "it sets a secret-like property"],
      ["ssh_key", "ssh_private_key_credentials records hold credentials or certificates"],
      ["hr_source", "it sets the secret field jdbc_password"],
      ["hidden", "snagentic could not read the class of x_hidden_child"],
    ]);
  });

  it("leaves updates holding secrets out of an export, and says which", async () => {
    const { deps } = instance();
    const exported = await exportUpdateSet(deps, "pdi", OLD, "admin", LIVE);
    expect(exported.updates).toBe(1);
    expect(exported.xml).not.toContain("s3cret");
    expect(exported.withheld).toEqual([
      { name: "sys_properties_1", target: "x.api_key", reason: expect.any(String) },
    ]);
  });
});

// ADR-0038, section 6: an accelerator upgrade completes the pack's earlier update sets.
describe("update set state for accelerator upgrades", () => {
  const sets = () => ({
    sys_update_set: [
      set(ALICE, "snagentic: itsm 0.1.0 upgrade", "in progress", "2026-10-01 10:00:00", {
        parent: "",
        sys_created_on: "2026-10-01 09:00:00",
      }),
      set(BOB, "snagentic: itsm 0.1.0 upgrade [sn_sow_inc]", "in progress", "2026-10-01 10:00:00", {
        parent: ALICE,
        sys_created_on: "2026-10-01 09:30:00",
      }),
      set(OLD, "Shipped", "complete", "2026-09-01 10:00:00", { parent: "" }),
    ],
  });

  it("reads the update sets in progress, with their parents and when they were created", async () => {
    const fake = fakeInstance(sets());
    const pager = new KeysetPager(fake.reader);
    expect(await openUpdateSets({ pager, statistics: fake.reader, now: () => NOW }, LIVE)).toEqual([
      {
        sysId: ALICE,
        name: "snagentic: itsm 0.1.0 upgrade",
        parent: "",
        createdOn: "2026-10-01 09:00:00",
      },
      {
        sysId: BOB,
        name: "snagentic: itsm 0.1.0 upgrade [sn_sow_inc]",
        parent: ALICE,
        createdOn: "2026-10-01 09:30:00",
      },
    ]);
  });

  it("completes a set by its sys_id, writing only its state", async () => {
    const fake = fakeInstance(sets());
    await completeUpdateSets(fake.reader.writer, [ALICE], LIVE);
    expect(fake.writes).toEqual(["update sys_update_set state=complete"]);
  });
});
