import type { DocPage } from "./page";
import type { Built } from "./site-context";
import { pageFile } from "./site-layout";
import { guideOf } from "./site-nav";
import type { View } from "./views";

// One searchable page: its title, where it is, its guide, and its headings and summary in lower
// case. The index is a script, not JSON, so the search works from a file as well as a server.
interface Entry {
  readonly t: string;
  readonly u: string;
  readonly g: "employee" | "it";
  readonly x: string;
}

// The page's headings in one reader's view: a heading for the other reader is left out.
function headings(page: DocPage, view: View | undefined): string {
  return page.body
    .split("\n")
    .filter((line) => /^#{2,3} /.test(line))
    .filter((line) => view === undefined || !/\{for=/.test(line) || line.includes(`{for=${view}}`))
    .map((line) =>
      line
        .replace(/^#+ /, "")
        .replace(/\{[^}]*\}/g, "")
        .trim(),
    )
    .join(" · ");
}

function entry(b: Built, page: DocPage, view: View | undefined): Entry {
  const file = pageFile(page, view ?? "user");
  const summary =
    b.input.processes
      .find((process) => process.id === page.process)
      ?.capabilities.find((capability) => capability.id === page.topic)?.summary ?? "";
  return {
    t: page.title,
    u: file,
    g: guideOf(b, file) === "employee" ? "employee" : "it",
    x: `${headings(page, view)} ${summary}`.toLowerCase(),
  };
}

export function searchScript(b: Built): string {
  const entries = b.input.pages.flatMap((page) =>
    page.section === "understand"
      ? [entry(b, page, "user"), entry(b, page, "operator")]
      : [entry(b, page, undefined)],
  );
  return `window.SNAGENTIC_SEARCH=${JSON.stringify(entries)};\n`;
}
