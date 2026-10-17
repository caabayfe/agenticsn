import { SnagenticError } from "../../kernel/errors";

export class DocumentationSourceError extends SnagenticError {
  constructor(path: string, problem: string) {
    super(
      "documentation-source-invalid",
      "usage",
      `${path}: ${problem}`,
      "fix the file under documentation/ (see the servicenow-document skill for the format)",
    );
  }
}

export class NoDocumentationError extends SnagenticError {
  constructor(root: string) {
    super(
      "no-documentation",
      "precondition",
      `${root} has no documentation/site.yaml`,
      "create documentation/site.yaml with title and instance, then a process under documentation/processes/<process>/ (process.yaml and its pages)",
    );
  }
}
