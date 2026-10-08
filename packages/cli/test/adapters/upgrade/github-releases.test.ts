import { afterAll, describe, expect, it } from "bun:test";
import { GitHubReleases } from "../../../src/adapters/upgrade/github-releases";

const agents: string[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    agents.push(request.headers.get("user-agent") ?? "");
    switch (url.pathname) {
      case "/api/releases/latest":
        return Response.json({ tag_name: "v1.3.0", body: "### Added\n" });
      case "/api/releases":
        return Response.json([
          { tag_name: "v1.3.0", body: "notes 1.3.0", draft: false },
          { tag_name: "v1.4.0-rc", body: "", draft: true },
          { tag_name: "v1.2.1", body: null, draft: false },
        ]);
      case "/dl/v1.3.0/snagentic-macos-arm64":
        return new Response(new Uint8Array([1, 2, 3]));
      case "/dl/v1.3.0/SHA256SUMS":
        return new Response("abc  snagentic-macos-arm64\n");
      case "/slow/releases/latest":
        await Bun.sleep(500);
        return Response.json({ tag_name: "v9.9.9" });
      case "/bad/releases/latest":
        return Response.json({ message: "API rate limit exceeded" }, { status: 403 });
      default:
        return new Response("Not Found", { status: 404 });
    }
  },
});
afterAll(() => server.stop(true));

const signal = new AbortController().signal;
const releases = (api = "api", timeoutMs = 2000) =>
  new GitHubReleases({
    api: `${server.url}${api}`,
    downloads: `${server.url}dl`,
    userAgent: "snagentic/1.2.1",
    timeoutMs,
  });

describe("GitHubReleases (ADR-0023)", () => {
  it("reads the latest release's version and notes, naming itself", async () => {
    expect(await releases().latest(signal)).toEqual({ version: "1.3.0", notes: "### Added\n" });
    expect(agents.at(-1)).toBe("snagentic/1.2.1");
  });

  it("lists published releases, newest first, leaving out drafts", async () => {
    expect(await releases().list(signal)).toEqual([
      { version: "1.3.0", notes: "notes 1.3.0" },
      { version: "1.2.1", notes: "" },
    ]);
  });

  it("downloads a release's binary and its SHA256SUMS", async () => {
    const { binary, sums } = await releases().download("1.3.0", "snagentic-macos-arm64", signal);
    expect([...binary]).toEqual([1, 2, 3]);
    expect(sums).toBe("abc  snagentic-macos-arm64\n");
  });

  it("explains a missing release, an error answer and a slow one", async () => {
    await expect(
      releases().download("9.9.9", "snagentic-macos-arm64", signal),
    ).rejects.toMatchObject({
      code: "release-unavailable",
      message: expect.stringContaining("404"),
    });
    await expect(releases("bad").latest(signal)).rejects.toMatchObject({
      code: "release-unavailable",
      message: expect.stringContaining("403"),
    });
    await expect(releases("slow", 100).latest(signal)).rejects.toMatchObject({
      code: "release-unavailable",
    });
  });
});
