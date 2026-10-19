import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DataTemplates, Template } from "@snagentic/core";
import { runGit } from "../git/run-git";

// RFC 4180: fields separated by commas, quoted with "", quotes doubled inside quotes, records
// separated by CRLF or LF.
class CsvReader {
  readonly records: string[][] = [];
  private record: string[] = [];
  private field = "";
  private quoted = false;

  private endField(): void {
    this.record.push(this.field);
    this.field = "";
  }

  private endRecord(): void {
    this.endField();
    this.records.push(this.record);
    this.record = [];
  }

  // Characters read: 2 when a pair (a doubled quote, CRLF) was taken.
  private inQuotes(c: string, next: string | undefined): number {
    if (c !== '"') this.field += c;
    else if (next === '"') {
      this.field += '"';
      return 2;
    } else this.quoted = false;
    return 1;
  }

  private outside(c: string, next: string | undefined): number {
    if (c === '"') this.quoted = true;
    else if (c === ",") this.endField();
    else if (c === "\n" || c === "\r") {
      this.endRecord();
      return c === "\r" && next === "\n" ? 2 : 1;
    } else this.field += c;
    return 1;
  }

  read(text: string): string[][] {
    for (let i = 0; i < text.length; ) {
      const [c = "", next] = [text[i], text[i + 1]];
      i += this.quoted ? this.inQuotes(c, next) : this.outside(c, next);
    }
    if (this.field !== "" || this.record.length > 0) this.endRecord();
    return this.records.filter((r) => r.some((f) => f !== ""));
  }
}

export const parseCsv = (text: string): string[][] => new CsvReader().read(text);

// Templates as CSV files in a directory outside the workspace's tracked files.
export class CsvDataTemplates implements DataTemplates {
  async tracked(directory: string): Promise<boolean> {
    const listed = await runGit(["ls-files", "--", "."], directory);
    return listed.exitCode === 0 && listed.stdout.trim() !== "";
  }

  async read(directory: string, file: string): Promise<Template | null> {
    const text = await readFile(join(directory, file), "utf8").catch(() => null);
    return text === null ? null : this.parse(text);
  }

  parse(text: string): Template {
    const [columns = [], ...rows] = parseCsv(text.replace(/^\uFEFF/, ""));
    return { columns: columns.map((c) => c.trim()), rows };
  }
}
