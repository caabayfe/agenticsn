import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { LIVE_QUERY_LOG_FILE, type LiveQueryEntry, type LiveQueryLog } from "@snagentic/core";

// .snagentic/<name>/live-queries.jsonl: one JSON line per live query, appended and never
// rewritten. Local state, so never committed; readable by its owner only.
export class JsonlLiveQueryLog implements LiveQueryLog {
  readonly path: string;

  constructor(private readonly directory: string) {
    this.path = join(directory, LIVE_QUERY_LOG_FILE);
  }

  async append(entry: LiveQueryEntry): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await appendFile(this.path, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}
