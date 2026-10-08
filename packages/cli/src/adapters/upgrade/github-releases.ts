import {
  parseVersion,
  type ReleaseInfo,
  type ReleaseSource,
  ReleaseUnavailableError,
} from "@snagentic/core";

const REPOSITORY = "caabayfe/agenticsn";

export interface GitHubReleasesOptions {
  readonly api?: string;
  readonly downloads?: string;
  readonly userAgent: string;
  readonly timeoutMs?: number;
}

const releaseOf = (raw: unknown): ReleaseInfo | null => {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const tag = Reflect.get(raw, "tag_name");
  const body = Reflect.get(raw, "body");
  const version = typeof tag === "string" ? parseVersion(tag) : null;
  return version === null || Reflect.get(raw, "draft") === true
    ? null
    : { version, notes: typeof body === "string" ? body : "" };
};

// The project's releases on GitHub (ADR-0023): the public API for versions and notes, and the
// release download URLs for files. Not ServiceNow, so not through the request scheduler.
export class GitHubReleases implements ReleaseSource {
  private readonly api: string;
  private readonly downloads: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: GitHubReleasesOptions) {
    this.api = options.api ?? `https://api.github.com/repos/${REPOSITORY}`;
    this.downloads = options.downloads ?? `https://github.com/${REPOSITORY}/releases/download`;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async latest(signal: AbortSignal): Promise<ReleaseInfo> {
    const release = releaseOf(await (await this.get(`${this.api}/releases/latest`, signal)).json());
    if (release === null) {
      throw new ReleaseUnavailableError("the latest release", "GitHub's answer has no version");
    }
    return release;
  }

  async list(signal: AbortSignal): Promise<readonly ReleaseInfo[]> {
    const raw: unknown = await (await this.get(`${this.api}/releases?per_page=30`, signal)).json();
    return Array.isArray(raw)
      ? raw.map(releaseOf).filter((release): release is ReleaseInfo => release !== null)
      : [];
  }

  async download(version: string, asset: string, signal: AbortSignal) {
    const base = `${this.downloads}/v${version}`;
    const binary = new Uint8Array(await (await this.get(`${base}/${asset}`, signal)).arrayBuffer());
    const sums = await (await this.get(`${base}/SHA256SUMS`, signal)).text();
    return { binary, sums };
  }

  private async get(url: string, signal: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { "User-Agent": this.options.userAgent, Accept: "application/vnd.github+json" },
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
      });
    } catch (error) {
      throw new ReleaseUnavailableError(
        url,
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!response.ok) {
      throw new ReleaseUnavailableError(url, `GitHub answered ${response.status}`);
    }
    return response;
  }
}
