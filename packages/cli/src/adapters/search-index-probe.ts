import { Database } from "bun:sqlite";
import type { EnvironmentProbe } from "@snagentic/core";
import { failedCheck, okCheck } from "./check-results";

export type OpenDatabase = () => Database;

const NAME = "search-index";

// Confirms the embedded SQLite supports FTS5, which the knowledge index relies on.
export function searchIndexProbe(
  openDatabase: OpenDatabase = () => new Database(":memory:"),
): EnvironmentProbe {
  return {
    name: NAME,
    async run() {
      let database: Database | undefined;
      try {
        database = openDatabase();
        const version = database
          .query<{ version: string }, []>("select sqlite_version() as version")
          .get()?.version;
        database.run("create virtual table probe using fts5(body)");
        database.run("insert into probe (body) values ('GlideRecord current.update()')");
        const hits = database
          .query<{ hits: number }, []>(
            "select count(*) as hits from probe where probe match 'glide*'",
          )
          .get()?.hits;
        if (hits !== 1) {
          return failedCheck(NAME, "FTS5 returned unexpected results", "please report this");
        }
        return okCheck(NAME, `SQLite ${version ?? "unknown"} with FTS5`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return failedCheck(
          NAME,
          `SQLite full-text search is not available: ${reason}`,
          "this build of snagentic lacks SQLite FTS5; please report it",
        );
      } finally {
        database?.close();
      }
    },
  };
}
