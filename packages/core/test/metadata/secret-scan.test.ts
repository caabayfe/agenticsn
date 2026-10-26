import { describe, expect, it } from "bun:test";
import { scanDocumentSecrets, scanSecrets, sortSecretRedactions } from "@snagentic/core";
import fc from "fast-check";

describe("secret scan (ADR-0035)", () => {
  it.each([
    [
      "private-key",
      "before\n-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----\nafter",
      "before\n[redacted:private-key]\nafter",
    ],
    ["aws-access-key-id", "key=AKIAIOSFODNN7EXAMPLE", "key=[redacted:aws-access-key-id]"],
    [
      "github-token",
      "token ghp_1234567890abcdefghijklmnopqrstuvwxyz",
      "token [redacted:github-token]",
    ],
    [
      "slack-token",
      ["xoxb", "123456789012", "123456789012", "abcdefghijklmnopqrstuvwx"].join("-"),
      "[redacted:slack-token]",
    ],
    ["google-api-key", `AIza${"A".repeat(35)}`, "[redacted:google-api-key]"],
    [
      "jwt",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      "[redacted:jwt]",
    ],
    [
      "url-credentials",
      "GET https://admin:hunter2@example.com/api",
      "GET https://[redacted:url-credentials]@example.com/api",
    ],
    [
      "authorization-token",
      "Authorization: Basic YWRtaW46cGFzc3dvcmQ=",
      "Authorization: Basic [redacted:authorization-token]",
    ],
  ] as const)("redacts a %s without removing the surrounding text", (id, input, output) => {
    expect(scanSecrets(input)).toEqual({ text: output, patterns: [id] });
  });

  it.each([
    "AKIA is a word, not an access key",
    "basic pwd-reset is a CSS class",
    "Authorization: Basic short",
    "https://example.com/api",
    "one.two.three",
    "-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----",
  ])("leaves an ordinary value unchanged (%p)", (text) => {
    expect(scanSecrets(text)).toEqual({ text, patterns: [] });
  });

  it("uses the more specific authorization pattern before the JWT pattern", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(scanSecrets(`Authorization: Bearer ${jwt}`)).toEqual({
      text: "Authorization: Bearer [redacted:authorization-token]",
      patterns: ["authorization-token"],
    });
  });

  it("reports each pattern once in stable priority order", () => {
    const result = scanSecrets(
      "AKIAIOSFODNN7EXAMPLE and AKIAIOSFODNN7EXAMPLE and ghp_1234567890abcdefghijklmnopqrstuvwxyz",
    );
    expect(result.patterns).toEqual(["aws-access-key-id", "github-token"]);
  });

  it("scans every string in a nested YAML-shaped document", () => {
    expect(
      scanDocumentSecrets({
        rows: [
          { script: "const key = 'AKIAIOSFODNN7EXAMPLE';" },
          { endpoint: "https://admin:hunter2@example.com/api" },
        ],
      }),
    ).toEqual({
      document: {
        rows: [
          { script: "const key = '[redacted:aws-access-key-id]';" },
          { endpoint: "https://[redacted:url-credentials]@example.com/api" },
        ],
      },
      patterns: ["aws-access-key-id", "url-credentials"],
    });
  });

  it("is idempotent for arbitrary text", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const once = scanSecrets(text);
        expect(scanSecrets(once.text)).toEqual({ text: once.text, patterns: [] });
      }),
    );
  });

  it("sorts redaction reports by path", () => {
    expect(
      sortSecretRedactions([
        { path: "z.yaml", patterns: ["jwt"] },
        { path: "a.yaml", patterns: ["private-key"] },
      ]),
    ).toEqual([
      { path: "a.yaml", patterns: ["private-key"] },
      { path: "z.yaml", patterns: ["jwt"] },
    ]);
  });
});
