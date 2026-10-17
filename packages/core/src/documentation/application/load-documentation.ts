import { NoDocumentationError } from "../domain/errors";
import { parseDocPage } from "../domain/page";
import { parseProcess } from "../domain/process";
import { parseScene } from "../domain/scene";
import { parseSiteConfig } from "../domain/site-config";
import type { DocSet } from "../domain/structure";
import type { DocumentationSources } from "../ports";

export type Documentation = DocSet;

export async function loadDocumentation(
  sources: DocumentationSources,
  root: string,
): Promise<Documentation> {
  const site = await sources.site();
  if (site === null || site === undefined) {
    throw new NoDocumentationError(root);
  }
  const config = parseSiteConfig(site);
  const processes = (await sources.processes()).map((source) =>
    parseProcess(source.path, source.process),
  );
  const pages = (await sources.pages()).map((source) => parseDocPage(source.path, source));
  const scenes = (await sources.scenes()).map((source) => parseScene(source.path, source));
  return { config, processes, pages, scenes };
}
