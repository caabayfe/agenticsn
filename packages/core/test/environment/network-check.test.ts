import { describe, expect, it } from "bun:test";
import { checkMcpConfigs, networkCheck, type WorkspaceFiles } from "@snagentic/core";

describe("the network check", () => {
  it("reports a direct connection with the built-in certificates when nothing is set", () => {
    expect(networkCheck({ PATH: "/usr/bin" })).toEqual({
      name: "network",
      status: "ok",
      detail: "direct connection; built-in certificate list",
      hint: null,
    });
  });

  it("shows the proxy and the extra certificates in use, in either case", () => {
    const check = networkCheck({
      HTTPS_PROXY: "http://proxy.corp.example:8080",
      no_proxy: "localhost,.corp.example",
      NODE_EXTRA_CA_CERTS: "/etc/corp/ca.pem",
    });
    expect(check.status).toBe("ok");
    expect(check.detail).toBe(
      "HTTPS_PROXY=http://proxy.corp.example:8080, no_proxy=localhost,.corp.example; " +
        "NODE_EXTRA_CA_CERTS=/etc/corp/ca.pem",
    );
  });

  it("never shows the credentials embedded in a proxy address", () => {
    const { detail } = networkCheck({
      HTTPS_PROXY: "http://alice:s3cret@proxy.corp.example:8080",
      http_proxy: "bob:hunter2@proxy.corp.example:3128",
      ALL_PROXY: "socks5://tok@10.0.0.1:1080/",
    });
    expect(detail).toBe(
      "HTTPS_PROXY=http://***@proxy.corp.example:8080, http_proxy=***@proxy.corp.example:3128, " +
        "ALL_PROXY=socks5://***@10.0.0.1:1080/; built-in certificate list",
    );
    expect(detail).not.toContain("s3cret");
    expect(detail).not.toContain("hunter2");
    expect(detail).not.toContain("tok@");
  });

  it("reports a replaced certificate list without a proxy", () => {
    expect(networkCheck({ SSL_CERT_FILE: "/etc/ssl/cert.pem", HTTP_PROXY: "" }).detail).toBe(
      "direct connection; SSL_CERT_FILE=/etc/ssl/cert.pem",
    );
  });
});

const CONFIGS = [
  { path: ".mcp.json", key: "mcpServers" },
  { path: ".vscode/mcp.json", key: "servers" },
] as const;

const filesWith = (contents: Record<string, string>): WorkspaceFiles => ({
  read: async (path) => contents[path] ?? null,
  write: async () => {},
  remove: async () => {},
  list: async () => [],
});

describe("the MCP config check", () => {
  it("is ok when snagentic's server entries set no network or runtime variables", async () => {
    const files = filesWith({
      "/w/.mcp.json": JSON.stringify({
        mcpServers: {
          snagentic: { command: "snagentic", args: ["mcp"] },
          // Another server's environment is not snagentic's traffic.
          other: { command: "x", env: { HTTPS_PROXY: "http://p:1" } },
        },
      }),
      "/w/.vscode/mcp.json": JSON.stringify({
        servers: {
          snagentic: { command: "snagentic", env: { SNAGENTIC_WORKSPACE: "/w" } },
        },
      }),
    });
    expect(await checkMcpConfigs(files, "/w", CONFIGS)).toEqual({
      name: "mcp-config",
      status: "ok",
      detail: "snagentic's server sets no network or runtime variables",
      hint: null,
    });
  });

  it("fails when a config gives snagentic's server a proxy, certificates or runtime options", async () => {
    const files = filesWith({
      "/w/.mcp.json": JSON.stringify({
        mcpServers: { snagentic: { command: "snagentic", env: { https_proxy: "http://p:1" } } },
      }),
      "/w/.vscode/mcp.json": JSON.stringify({
        servers: {
          snagentic: {
            command: "snagentic",
            env: { NODE_EXTRA_CA_CERTS: "/tmp/ca.pem", BUN_OPTIONS: "--preload x" },
          },
        },
      }),
    });
    const check = await checkMcpConfigs(files, "/w", CONFIGS);
    expect(check.status).toBe("fail");
    expect(check.detail).toBe(
      ".mcp.json sets https_proxy; .vscode/mcp.json sets NODE_EXTRA_CA_CERTS, BUN_OPTIONS",
    );
    expect(check.hint).toContain("docs/guides/network.md");
  });

  it("fails when the host's settings give every command a runtime variable (SEC3-05)", async () => {
    const files = filesWith({
      "/w/.claude/settings.json": JSON.stringify({
        // A proxy here is the person's own network choice; a runtime variable never is.
        env: { BUN_BE_BUN: "1", HTTPS_PROXY: "http://p:1", EDITOR: "vi" },
      }),
      "/w/.claude/settings.local.json": JSON.stringify({ env: { BUN_OPTIONS: "--smol" } }),
    });
    const check = await checkMcpConfigs(files, "/w", CONFIGS);
    expect(check.status).toBe("fail");
    expect(check.detail).toBe(
      ".claude/settings.json sets BUN_BE_BUN; .claude/settings.local.json sets BUN_OPTIONS",
    );
  });

  it("accepts host settings without an environment, or that cannot be read", async () => {
    for (const text of ["{ not json", "[]", JSON.stringify({ env: "x" }), JSON.stringify({})]) {
      const files = filesWith({ "/w/.claude/settings.json": text });
      expect((await checkMcpConfigs(files, "/w", CONFIGS)).status).toBe("ok");
    }
  });

  it("ignores missing or unreadable configs", async () => {
    const files = filesWith({ "/w/.mcp.json": "{ not json" });
    expect((await checkMcpConfigs(files, "/w", CONFIGS)).status).toBe("ok");
  });
});
