import type { Operation } from "./change";
import type { LayoutKind } from "./layout-kinds";
import type { LayoutView } from "./layout-xml";

// A layout planned whole (ADR-0029, ADR-0030): what push loads, and what the plan id binds.

export type Row = Readonly<Record<string, string>>;

export interface SectionRef {
  readonly caption: string;
  readonly domain: string;
  readonly viewSysId: string;
}

export interface PlannedLayout {
  readonly kind: LayoutKind;
  readonly operation: Operation;
  // The record's file, relative to the metadata root.
  readonly path: string;
  readonly scope: string;
  readonly sysId: string;
  // The table the layout is for (the record's name field).
  readonly table: string;
  readonly view: LayoutView;
  // "global" or the domain's sys_id.
  readonly domain: string;
  // The record fields the update carries, identity included.
  readonly fields: Readonly<Record<string, string>>;
  // Each row's sys_id and carried fields, in position order.
  readonly rows: readonly Row[];
  // The update set entry the load records.
  readonly updateName: string;
  // For a form: each section it shows, as the platform matches it (filled in from the files).
  readonly sections: Readonly<Record<string, SectionRef>>;
  // Versions as pulled (sys_mod_count|sys_updated_on) of the record and of each row, by sys_id;
  // push stops if the instance's differ. Null for a new layout.
  readonly base: {
    readonly record: string;
    readonly rows: Readonly<Record<string, string>>;
  } | null;
}
