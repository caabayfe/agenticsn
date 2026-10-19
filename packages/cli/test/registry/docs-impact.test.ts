import { afterEach, describe, expect, it } from "bun:test";
import { docsImpact, impactMarkdown } from "../../src/registry/docs-impact";
import { executeUseCase } from "../../src/registry/execute";
import { instanceWorkspace } from "../support/instance-workspace";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const RULE = "sys_script/0c1345dd0783f01028ef0a701ad300fa";

describe("docs impact", () => {
  it("prints, by reader, each claim a change may make wrong, as Markdown for a pull request", () => {
    const text = impactMarkdown({
      base: "origin/main",
      units: 1,
      items: [
        {
          page: "documentation/processes/incident/use/report.md",
          title: "Report an incident",
          record: RULE,
          evidence: ["E02"],
          cause: { kind: "source", files: ["source/global/src/fluent/route.now.ts"] },
          claims: [
            { heading: "What happens next", reader: "employees", text: "IT routes it." },
            { heading: "Routing", reader: "platform", text: "The rule sets the group." },
          ],
        },
        {
          page: "documentation/processes/incident/configure/email.md",
          title: "Inbound email",
          record: "sysevent_in_email_action/3ccf",
          evidence: ["E01"],
          cause: { kind: "instance", status: "changed" },
          claims: [{ heading: "Replies", reader: "platform", text: "Replies add a comment." }],
        },
      ],
    });
    expect(text).toBe(
      [
        "## Documentation impact",
        "",
        "3 claim(s) on 2 page(s) may no longer be true, from source changed since origin/main and from changes on the instance.",
        "",
        "### Employees",
        "",
        '- [Report an incident](documentation/processes/incident/use/report.md) › What happens next: "IT routes it."',
        `  E02 \`${RULE}\`, changed by \`source/global/src/fluent/route.now.ts\``,
        "",
        "### Platform team",
        "",
        '- [Report an incident](documentation/processes/incident/use/report.md) › Routing: "The rule sets the group."',
        `  E02 \`${RULE}\`, changed by \`source/global/src/fluent/route.now.ts\``,
        '- [Inbound email](documentation/processes/incident/configure/email.md) › Replies: "Replies add a comment."',
        "  E01 `sysevent_in_email_action/3ccf`, changed on the instance since the page was checked",
        "",
        "Fix each page in the same change: check the claim against the change, correct it, then run `snagentic docs pin` on the page.",
      ].join("\n"),
    );
  });

  it("finds nothing to say in a workspace without changes or documentation", async () => {
    const ws = await instanceWorkspace({});
    cleanups.push(ws.cleanup);
    const { output, exitCode } = await executeUseCase(docsImpact, {}, ws.context);
    expect(output).toEqual({ instance: "pdi", base: "HEAD", units: 0, items: [] });
    expect(exitCode).toBe(0);
    expect(docsImpact.render(output as never, "text")).toBe(
      "No documentation is affected by the changes since HEAD.",
    );
  });
});
