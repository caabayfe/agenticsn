import { describe, expect, it } from "bun:test";
import { DocumentationSourceError, parseProcess } from "@snagentic/core";

const PATH = "processes/incident/process.yaml";
const roles = [{ id: "caller", name: "Caller" }];

describe("process files", () => {
  it("reads the process, its roles, lifecycle and capabilities in order", () => {
    const process = parseProcess(PATH, {
      title: "Incident management",
      summary: "Restore service.",
      order: 1,
      roles,
      lifecycle: [{ state: "New", meaning: "logged" }],
      capabilities: [
        { id: "report", title: "Report", roles: ["caller"] },
        { id: "track", title: "Track" },
      ],
    });
    expect(process).toEqual({
      id: "incident",
      title: "Incident management",
      summary: "Restore service.",
      order: 1,
      roles: [{ id: "caller", name: "Caller", description: "" }],
      lifecycle: [{ state: "New", meaning: "logged" }],
      capabilities: [
        { id: "report", title: "Report", summary: "", roles: ["caller"] },
        { id: "track", title: "Track", summary: "", roles: [] },
      ],
    });
  });

  it("refuses a process without a title", () => {
    expect(() => parseProcess(PATH, {})).toThrow(DocumentationSourceError);
  });

  it("refuses a capability for a role the process does not name", () => {
    expect(() =>
      parseProcess(PATH, { title: "T", roles, capabilities: [{ id: "x", roles: ["manager"] }] }),
    ).toThrow(/unknown roles: manager/);
  });

  it("refuses a capability listed twice, or one called overview", () => {
    expect(() =>
      parseProcess(PATH, { title: "T", capabilities: [{ id: "x" }, { id: "x" }] }),
    ).toThrow(/listed twice/);
    expect(() => parseProcess(PATH, { title: "T", capabilities: [{ id: "overview" }] })).toThrow(
      /process's own page/,
    );
  });

  it("refuses ids that are not lowercase words, and lists that are not lists", () => {
    expect(() => parseProcess(PATH, { title: "T", capabilities: [{ id: "Report It" }] })).toThrow(
      /id/,
    );
    expect(() => parseProcess(PATH, { title: "T", roles: "caller" })).toThrow(/must be a list/);
  });
});
