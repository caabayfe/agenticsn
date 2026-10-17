import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MirrorListing, MirrorRecord, MirrorRecords } from "@snagentic/core";
import { fromYamlStrings } from "../yaml/own-style";

const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// A record's own file, <slug>--<sys_id>.yaml; not a long field's or a children file.
const RECORD_FILE = /--([A-Za-z0-9_]{1,64})\.yaml$/;

function textFields(record: Record<string, unknown>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(record)) {
    if (name !== "_meta" && typeof value === "string") {
      fields[name] = value;
    }
  }
  return fields;
}

const text = (value: unknown) => (typeof value === "string" ? value : undefined);

// A long field's file: <base>.<field>.<ext>; a children file: <base>.children.<table>.yaml
// (ADR-0017).
function partOfFile(
  base: string,
  file: string,
): { readonly field: string } | { readonly children: string } | null {
  const parts = file.slice(base.length + 1).split(".");
  if (parts.length === 3 && parts[0] === "children" && parts[1] !== undefined) {
    return { children: parts[1] };
  }
  return parts.length === 2 && parts[0] !== undefined && parts[0] !== "children"
    ? { field: parts[0] }
    : null;
}

// Records of one instance's mirror, found by table and sys_id (instances/<name>/metadata/
// <scope>/<table>/<slug>--<sys_id>.yaml).
export class FsMirrorRecords implements MirrorRecords {
  constructor(
    private readonly metadata: string,
    private readonly mirrorHead: () => Promise<string | null>,
  ) {}

  head(): Promise<string | null> {
    return this.mirrorHead();
  }

  private async find(table: string, sysId: string): Promise<string | null> {
    if (!existsSync(this.metadata)) {
      return null;
    }
    const pattern = `*/${table}/*--${sysId}.yaml`;
    for await (const path of new Bun.Glob(pattern).scan({ cwd: this.metadata })) {
      return path.slice(0, -".yaml".length);
    }
    return null;
  }

  async read(table: string, sysId: string): Promise<MirrorRecord | null> {
    const base = await this.find(table, sysId);
    if (base === null) {
      return null;
    }
    const parsed = fromYamlStrings(await readFile(join(this.metadata, `${base}.yaml`), "utf8"));
    const record = isMap(parsed) ? parsed : {};
    const meta = isMap(record["_meta"]) ? record["_meta"] : {};
    const fields = textFields(record);
    const folder = base.slice(0, base.lastIndexOf("/"));
    const leaf = base.slice(base.lastIndexOf("/") + 1);
    const children: Record<string, string> = {};
    for await (const file of new Bun.Glob(`${leaf}.*`).scan({ cwd: join(this.metadata, folder) })) {
      const part = partOfFile(leaf, file);
      if (part === null) {
        continue;
      }
      const text = await readFile(join(this.metadata, folder, file), "utf8");
      if ("field" in part) {
        fields[part.field] = text;
      } else {
        children[part.children] = text;
      }
    }
    const hash = meta["hash"];
    return { hash: typeof hash === "string" ? hash : "", fields, children };
  }

  async list(table: string, signal: AbortSignal): Promise<readonly MirrorListing[]> {
    if (!existsSync(this.metadata)) {
      return [];
    }
    const listings: MirrorListing[] = [];
    for await (const path of new Bun.Glob(`*/${table}/*.yaml`).scan({ cwd: this.metadata })) {
      signal.throwIfAborted();
      const leaf = path.slice(path.lastIndexOf("/") + 1);
      const sysId = RECORD_FILE.exec(leaf)?.[1];
      if (sysId === undefined || leaf.slice(0, -`--${sysId}.yaml`.length).includes(".")) {
        continue;
      }
      const parsed = fromYamlStrings(await readFile(join(this.metadata, path), "utf8"));
      const record = isMap(parsed) ? parsed : {};
      const meta = isMap(record["_meta"]) ? record["_meta"] : {};
      const updatedBy = text(meta["sys_updated_by"]);
      const updatedOn = text(meta["sys_updated_on"]);
      listings.push({
        sysId,
        fields: textFields(record),
        ...(updatedBy === undefined ? {} : { updatedBy }),
        ...(updatedOn === undefined ? {} : { updatedOn }),
      });
    }
    return listings;
  }
}
