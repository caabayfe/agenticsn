import { describe, expect, it } from "bun:test";
import {
  type FormLayout,
  formLayoutXml,
  formUpdateName,
  type SectionLayout,
  sectionLayoutXml,
  sectionUpdateName,
} from "@snagentic/core";
import {
  buildWithSdk,
  keyEntry,
  SCOPE,
  SDK_BUILD_TIMEOUT,
  viewKey,
} from "../../support/sdk-contract";

// ADR-0030: snagentic writes a form section's update itself, in the form the embedded SDK's
// Form() writes for each section. This builds a form with the SDK, ids pinned through its key
// registry, and requires the same bytes for each section.

const TABLE = "x_acme_app_task";
const DEFAULT = { sysId: "Default view", name: "" };

const field = (sysId: string, element: string, position: number, type = "") => ({
  sysId,
  element,
  position: String(position),
  type,
  formatter: "",
});

const SECTIONS: SectionLayout[] = [
  {
    sysId: "0573df1e1ca64448a2fac7f4962ef61f",
    table: TABLE,
    caption: "",
    view: DEFAULT,
    domain: "global",
    header: "false",
    title: "false",
    roles: "",
    elements: [
      field("0f048e47d2414c66a3b80a2d816b2edd", ".begin_split", 0, ".begin_split"),
      field("ec6ef416dbff40f989f26b7975d0927f", "number", 1),
      field("db3d016851ff4c35a58018b7f2131763", ".split", 2, ".split"),
      field("55ba0d1ba0604042a2f219fc72527285", "state", 3),
      field("584f100875df40aabccf9def6f62dbde", ".end_split", 4, ".end_split"),
    ],
  },
  {
    sysId: "b344b01adc314394989dc4de3974a7ef",
    table: TABLE,
    caption: "Notes",
    view: DEFAULT,
    domain: "global",
    header: "false",
    title: "false",
    roles: "",
    elements: [field("2d431b22afca409aac7e90b1e911282b", "description", 0)],
  },
];

const sectionKey = (s: SectionLayout) =>
  `{ name: '${s.table}', caption: '${s.caption || "NULL"}', view: ${viewKey(s.view)}, sys_domain: 'global' }`;

const sectionKeyOf = (sysId: string) => {
  const section = SECTIONS.find((s) => s.sysId === sysId);
  return section === undefined ? "{}" : sectionKey(section);
};

const FORM_ID = "45ecfc3bdd7d4ea69d2b22ce688b1fd9";
const formKey = `{ name: '${TABLE}', view: ${viewKey(DEFAULT)}, sys_domain: 'global' }`;
const FORM_LAYOUT: FormLayout = {
  sysId: FORM_ID,
  table: TABLE,
  view: DEFAULT,
  domain: "global",
  roles: "",
  sections: SECTIONS.map((s, index) => ({
    sysId: ["7c9a4f792ffb4c85b2271e2026df70d5", "beae6ea88ad8458499ae214cf124c9bb"][index] ?? "",
    position: String(index),
    section: { sysId: s.sysId, caption: s.caption, domain: "global", viewSysId: s.view.sysId },
  })),
};

const keys = [
  keyEntry("sys_ui_form", FORM_ID, formKey),
  ...FORM_LAYOUT.sections.map((f) =>
    keyEntry(
      "sys_ui_form_section",
      f.sysId,
      `{ sys_ui_form: { id: '${FORM_ID}', key: ${formKey} }, sys_ui_section: { id: '${f.section.sysId}', key: ${sectionKeyOf(f.section.sysId)} } }`,
    ),
  ),
  ...SECTIONS.flatMap((s) => [
    keyEntry("sys_ui_section", s.sysId, sectionKey(s)),
    ...s.elements.map((e) =>
      keyEntry(
        "sys_ui_element",
        e.sysId,
        `{ sys_ui_section: { id: '${s.sysId}', key: ${sectionKey(s)} }, element: '${e.element}', position: '${e.position}' }`,
      ),
    ),
  ]),
];

const FORM = `Form({ table: '${TABLE}', view: default_view, sections: [
  { caption: '', content: [{ layout: 'two-column', leftElements: [{ field: 'number', type: 'table_field' }], rightElements: [{ field: 'state', type: 'table_field' }] }] },
  { caption: 'Notes', content: [{ layout: 'one-column', elements: [{ field: 'description', type: 'table_field' }] }] },
] })`;

describe("form section update, against the embedded SDK (ADR-0030)", () => {
  it(
    "writes what the SDK's Form() writes for the form and each section, byte for byte",
    async () => {
      const { outcome, built } = await buildWithSdk(
        "import { default_view, Form } from '@servicenow/sdk/core'",
        FORM,
        keys,
      );
      expect(outcome.success).toBe(true);
      for (const section of SECTIONS) {
        expect(sectionLayoutXml(section, SCOPE)).toBe(built(sectionUpdateName(section)));
      }
      expect(formLayoutXml(FORM_LAYOUT, SCOPE)).toBe(built(formUpdateName(FORM_LAYOUT)));
    },
    SDK_BUILD_TIMEOUT,
  );
});
