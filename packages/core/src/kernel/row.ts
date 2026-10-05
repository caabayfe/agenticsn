// A ServiceNow row read with raw values and no reference links: every field is a string.
export type Row = Readonly<Record<string, string>>;
