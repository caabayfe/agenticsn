import { describe, expect, it } from "bun:test";
import {
  type ExistingMirrorFile,
  migrateExistingSecrets,
  SECRET_SCAN_VERSION,
} from "@snagentic/core";

const CATALOG = {
  parents: { sys_metadata: null },
  scopes: { global: "global" },
  typedFields: { sys_script: { script: "script_server" } },
};

function mirror(files: readonly ExistingMirrorFile[]) {
  const documents: unknown[] = [];
  const texts: unknown[] = [];
  const moved: unknown[] = [];
  let prepared = 0;
  let listed = 0;
  return {
    port: {
      prepare: async () => {
        prepared += 1;
      },
      existingFiles: async function* () {
        listed += 1;
        yield* files;
      },
      writeDocument: async (root: string, path: string, document: unknown) => {
        documents.push({ root, path, document });
      },
      writeText: async (root: string, path: string, text: string) => {
        texts.push({ root, path, text });
      },
      move: async (root: string, from: string, to: string) => {
        moved.push({ root, from, to });
      },
    },
    documents,
    texts,
    moved,
    prepared: () => prepared,
    listed: () => listed,
  };
}

describe("existing mirror secret migration", () => {
  it("redacts parsed YAML, field files and the local catalog, reporting no values", async () => {
    const aws = "AKIAIOSFODNN7EXAMPLE";
    const github = "ghp_0123456789abcdefghijklmnopqrstuvwxyz";
    const source = mirror([
      {
        kind: "document",
        path: "metadata/global/sys_script/rule--1.yaml",
        document: { script: aws },
      },
      {
        kind: "text",
        path: "metadata/global/sys_script/rule--1.script.js",
        text: `const token = "${github}";`,
      },
    ]);
    const result = await migrateExistingSecrets(
      source.port,
      "instances/pdi",
      ".snagentic/pdi/catalog.json",
      {
        ...CATALOG,
        scopes: { global: `Authorization: Bearer ${"x".repeat(24)}` },
      },
      {},
      new AbortController().signal,
    );
    expect(source.documents).toEqual([
      {
        root: "instances/pdi",
        path: "metadata/global/sys_script/rule--1.yaml",
        document: { script: "[redacted:aws-access-key-id]" },
      },
    ]);
    expect(source.texts).toEqual([
      {
        root: "instances/pdi",
        path: "metadata/global/sys_script/rule--1.script.js",
        text: 'const token = "[redacted:github-token]";',
      },
    ]);
    expect(result.catalog.scopes["global"]).toBe(
      "Authorization: Bearer [redacted:authorization-token]",
    );
    expect(result.secretRedactions).toEqual([
      {
        path: ".snagentic/pdi/catalog.json",
        patterns: ["authorization-token"],
      },
      {
        path: "instances/pdi/metadata/global/sys_script/rule--1.script.js",
        patterns: ["github-token"],
      },
      {
        path: "instances/pdi/metadata/global/sys_script/rule--1.yaml",
        patterns: ["aws-access-key-id"],
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(aws);
    expect(JSON.stringify(result)).not.toContain(github);
  });

  it("does no work once the current scan version is recorded", async () => {
    const source = mirror([]);
    const result = await migrateExistingSecrets(
      source.port,
      "instances/pdi",
      ".snagentic/pdi/catalog.json",
      CATALOG,
      { secretScanVersion: SECRET_SCAN_VERSION },
      new AbortController().signal,
    );
    expect(result).toEqual({ catalog: CATALOG, catalogChanged: false, secretRedactions: [] });
    expect(source.prepared()).toBe(0);
    expect(source.listed()).toBe(0);
  });

  // Spec 014, SEC2-03: a version above this binary's own isn't one it applied.
  it("scans again when the recorded version is above its own", async () => {
    const source = mirror([]);
    await migrateExistingSecrets(
      source.port,
      "instances/pdi",
      ".snagentic/pdi/catalog.json",
      CATALOG,
      { secretScanVersion: SECRET_SCAN_VERSION + 97 },
      new AbortController().signal,
    );
    expect(source.listed()).toBe(1);
  });

  // Spec 014, SEC2-02: values an earlier version wrote are taken out of the committed files.
  it("rewrites a committed credential header without its value, and reports it", async () => {
    const value = "placeholder-not-a-credential";
    const record = (name: string) => ({
      _meta: {
        sys_class_name: "sys_rest_message_headers",
        sys_id: "0123456789abcdef0123456789abcdef",
        scope: "global",
        hash: "stale",
        hash_version: 1,
      },
      name,
      value,
    });
    const path = "metadata/global/sys_rest_message_headers/authorization--1.yaml";
    const source = mirror([
      { kind: "document", path, document: record("Authorization") },
      {
        kind: "document",
        path: "metadata/global/sys_rest_message_headers/accept--2.yaml",
        document: record("Accept"),
      },
    ]);
    const result = await migrateExistingSecrets(
      source.port,
      "instances/pdi",
      ".snagentic/pdi/catalog.json",
      { ...CATALOG, parents: { sys_metadata: null, sys_rest_message_headers: "sys_metadata" } },
      { secretScanVersion: SECRET_SCAN_VERSION - 1 },
      new AbortController().signal,
    );
    expect(source.documents).toHaveLength(1);
    expect(source.documents[0]).toMatchObject({
      path,
      document: { _meta: { redacted: ["value"] }, name: "Authorization" },
    });
    expect(JSON.stringify(source.documents)).not.toContain(value);
    expect(result.secretRedactions).toEqual([
      { path: `instances/pdi/${path}`, patterns: ["credential-value"] },
    ]);
  });

  it("sanitizes a secret-shaped committed path without reporting the original", async () => {
    const leaked = "AKIAIOSFODNN7EXAMPLE";
    const source = mirror([{ kind: "text", path: `metadata/${leaked}.js`, text: "safe();\n" }]);
    const result = await migrateExistingSecrets(
      source.port,
      "instances/pdi",
      ".snagentic/pdi/catalog.json",
      CATALOG,
      {},
      new AbortController().signal,
    );
    expect(source.moved).toEqual([
      {
        root: "instances/pdi",
        from: `metadata/${leaked}.js`,
        to: "metadata/[redacted:aws-access-key-id].js",
      },
    ]);
    expect(result.secretRedactions).toEqual([
      {
        path: "instances/pdi/metadata/[redacted:aws-access-key-id].js",
        patterns: ["aws-access-key-id"],
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(leaked);
  });

  it("honors cancellation before rewriting another file", async () => {
    const controller = new AbortController();
    const source = mirror([
      {
        kind: "text",
        path: "metadata/one.script.js",
        text: "AKIAIOSFODNN7EXAMPLE",
      },
      {
        kind: "text",
        path: "metadata/two.script.js",
        text: "AKIAIOSFODNN7EXAMPLE",
      },
    ]);
    const original = source.port.writeText;
    source.port.writeText = async (...args) => {
      await original(...args);
      controller.abort();
    };
    await expect(
      migrateExistingSecrets(
        source.port,
        "instances/pdi",
        ".snagentic/pdi/catalog.json",
        CATALOG,
        {},
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(source.texts).toHaveLength(1);
  });
});
