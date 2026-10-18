import type { DocPage } from "./page";
import type { Process } from "./process";
import type { EmployeeGuide } from "./site-config";

// A guide entry, <process>/<topic>, names an employee page: a Use page or a shared Understand
// page, shown in the employee's view (ADR-0037).
export function employeePage(target: string, pages: readonly DocPage[]): DocPage | undefined {
  const [process, topic, ...rest] = target.split("/");
  if (rest.length > 0) {
    return undefined;
  }
  return pages.find(
    (page) =>
      page.process === process &&
      page.topic === topic &&
      (page.section === "use" || page.section === "understand"),
  );
}

// The processes the guide explains under "How it works": those site.yaml names, in its order, or
// every process.
export function explained(guide: EmployeeGuide, processes: readonly Process[]): readonly Process[] {
  if (guide.how === undefined) {
    return processes;
  }
  return guide.how.flatMap((id) => processes.filter((process) => process.id === id));
}

// Every entry of the guide, in order, without repeats.
export function guideEntries(guide: EmployeeGuide): readonly string[] {
  return [...new Set([...guide.start, ...guide.tasks.flatMap((task) => task.pages)])];
}

export function unknownGuidePages(
  guide: EmployeeGuide | undefined,
  pages: readonly DocPage[],
): readonly string[] {
  return guide === undefined
    ? []
    : guideEntries(guide).filter((target) => employeePage(target, pages) === undefined);
}
