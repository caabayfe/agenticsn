import { describe, expect, it } from "bun:test";
import { viewMarks, viewOf } from "@snagentic/core";

const SHARED = `Shared intro.

## What the states mean

Both readers see this.

### In Employee Center {for=user}

Open, Awaiting your response.

#### Detail for users

Still the user's.

### In the workspace {for=operator}

New, In Progress, On Hold.

## Deadlines

Shared again.
`;

describe("audience views of a shared page", () => {
  it("keeps the user's sections and drops the operator's, up to the next heading of the same level", () => {
    const user = viewOf(SHARED, "user");
    expect(user).toContain("### In Employee Center\n");
    expect(user).toContain("#### Detail for users");
    expect(user).not.toContain("In the workspace");
    expect(user).not.toContain("On Hold");
    expect(user).toContain("## Deadlines");
    expect(user).toContain("Shared intro.");
  });

  it("keeps the operator's sections and drops the user's", () => {
    const operator = viewOf(SHARED, "operator");
    expect(operator).toContain("### In the workspace\n");
    expect(operator).not.toContain("Awaiting your response");
    expect(operator).not.toContain("Detail for users");
    expect(operator).toContain("Both readers see this.");
  });

  it("keeps a label on a limited heading", () => {
    expect(viewOf("## New rule {label=NEW} {for=user}\ntext\n", "user")).toBe(
      "## New rule {label=NEW}\ntext\n",
    );
  });

  it("leaves headings inside code blocks alone", () => {
    const source = "```\n## Not a heading {for=operator}\n```\n";
    expect(viewOf(source, "user")).toBe(source);
  });

  it("lists every audience mark, including unknown ones", () => {
    expect(viewMarks(`${SHARED}\n## Odd {for=admin}\n`)).toEqual(["user", "operator", "admin"]);
  });
});
