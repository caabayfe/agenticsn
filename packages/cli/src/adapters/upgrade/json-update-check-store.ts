import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { UpdateCheck, UpdateCheckStore } from "@snagentic/core";

// Where the notice remembers its last check: the user's cache folder, never a workspace.
export function updateCheckFile(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
  platform: string,
): string {
  const cache =
    env["XDG_CACHE_HOME"] ??
    (platform === "darwin"
      ? join(home, "Library", "Caches")
      : platform === "win32"
        ? (env["LOCALAPPDATA"] ?? join(home, "AppData", "Local"))
        : join(home, ".cache"));
  return join(cache, "snagentic", "update-check.json");
}

export class JsonUpdateCheckStore implements UpdateCheckStore {
  constructor(private readonly file: string) {}

  async read(): Promise<UpdateCheck | null> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.file, "utf8"));
      const checkedAt =
        raw !== null && typeof raw === "object" ? Reflect.get(raw, "checkedAt") : null;
      const latest = raw !== null && typeof raw === "object" ? Reflect.get(raw, "latest") : null;
      return typeof checkedAt === "string"
        ? { checkedAt, latest: typeof latest === "string" ? latest : null }
        : null;
    } catch {
      return null;
    }
  }

  async write(check: UpdateCheck): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, `${JSON.stringify(check)}\n`);
  }
}
