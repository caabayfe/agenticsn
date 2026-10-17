import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MirrorRecord, MirrorRecords } from "@snagentic/core";
import { fromYamlStrings } from "../yaml/own-style";

const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// A long field's file: <base>.<field>.<ext> (ADR-0017); children files are not fields.
function fieldOfFile(base: string, file: string): string | null {
  const rest = file.slice(base.length + 1);
  const parts = rest.split(".");
  return parts.length === 2 && parts[0] !== undefined && parts[0] !== "children" ? parts[0] : null;
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
    const fields: Record<string, string> = {};
    for (const [name, value] of Object.entries(record)) {
      if (name !== "_meta" && typeof value === "string") {
        fields[name] = value;
      }
    }
    const folder = base.slice(0, base.lastIndexOf("/"));
    const leaf = base.slice(base.lastIndexOf("/") + 1);
    for await (const file of new Bun.Glob(`${leaf}.*`).scan({ cwd: join(this.metadata, folder) })) {
      const field = fieldOfFile(leaf, file);
      if (field !== null) {
        fields[field] = await readFile(join(this.metadata, folder, file), "utf8");
      }
    }
    const hash = meta["hash"];
    return { hash: typeof hash === "string" ? hash : "", fields };
  }
}
