import { describe, expect, it } from "bun:test";
import { claimsOf, type DocPage } from "@snagentic/core";

const page = (section: DocPage["section"], body: string): DocPage => ({
  path: `processes/incident/${section}/report.md`,
  process: "incident",
  section,
  topic: "report",
  title: "Report an incident",
  evidence: [],
  body,
});

describe("the claims a piece of evidence supports (ADR-0039)", () => {
  it("finds each paragraph, list item and table row citing it, under its heading", () => {
    const body = [
      "Open Employee Center. [E01]",
      "",
      "## What happens next {label=NEW}",
      "",
      "1. Choose **Report an issue**. [E02]",
      "2. Describe it in [the form](see:incident/report),",
      "   then submit. [E01]",
      "",
      "| State | Meaning |",
      "|---|---|",
      "| New | nobody works on it yet [E01] |",
      "| Closed | done [E03] |",
      "| Assigned | | the assignee | [E01] |",
      "",
      "```",
      "not a claim [E01]",
      "```",
    ].join("\n");
    expect(claimsOf(page("use", body), ["E01"])).toEqual([
      { heading: "Report an incident", reader: "employees", text: "Open Employee Center." },
      {
        heading: "What happens next",
        reader: "employees",
        text: "Describe it in the form, then submit.",
      },
      { heading: "What happens next", reader: "employees", text: "New · nobody works on it yet" },
      { heading: "What happens next", reader: "employees", text: "Assigned · the assignee" },
    ]);
    expect(claimsOf(page("use", body), ["E02"])[0]?.text).toBe("Choose Report an issue.");
  });

  it("names the reader by section, and in a shared page by the heading's view", () => {
    const shared = [
      "Something broke. [E01]",
      "",
      "## Where you see it {for=user}",
      "",
      "In Employee Center. [E01]",
      "",
      "### Details",
      "",
      "Still for you. [E01]",
      "",
      "## Where you see it {for=operator}",
      "",
      "In the workspace. [E01]",
    ].join("\n");
    expect(claimsOf(page("understand", shared), ["E01"]).map((claim) => claim.reader)).toEqual([
      "everyone",
      "employees",
      "employees",
      "operators",
    ]);
    expect(claimsOf(page("operate", "Do it. [E01]"), ["E01"])[0]?.reader).toBe("operators");
    expect(claimsOf(page("configure", "It runs. [E01]"), ["E01"])[0]?.reader).toBe("platform");
  });

  it("keeps a long claim short, and finds none for evidence the page doesn't cite", () => {
    const long = `${"word ".repeat(80)}[E01]`;
    const [claim] = claimsOf(page("use", long), ["E01"]);
    expect(claim?.text.length).toBeLessThanOrEqual(240);
    expect(claim?.text.endsWith("…")).toBe(true);
    expect(claimsOf(page("use", "Text [E010]."), ["E01"])).toEqual([]);
  });
});
