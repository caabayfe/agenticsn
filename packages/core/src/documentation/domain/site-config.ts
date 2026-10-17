import { DocumentationSourceError } from "./errors";
import { fieldsOf, textOf } from "./fields";

export interface SiteConfig {
  readonly title: string;
  // The instance whose mirror the pages are verified against.
  readonly instance: string;
  readonly footer: string;
}

export function parseSiteConfig(raw: unknown): SiteConfig {
  const fields = fieldsOf(raw);
  const title = textOf(fields["title"]);
  const instance = textOf(fields["instance"]);
  if (title === undefined || instance === undefined) {
    throw new DocumentationSourceError("site.yaml", "needs title and instance");
  }
  return { title, instance, footer: textOf(fields["footer"]) ?? "" };
}
