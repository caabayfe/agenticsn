import { NoDocumentationError } from "../domain/errors";
import { type DocPage, parseDocPage } from "../domain/page";
import { type Process, parseProcess } from "../domain/process";
import { parseScene, type Scene } from "../domain/scene";
import { parseSiteConfig, type SiteConfig } from "../domain/site-config";
import type { DocumentationSources } from "../ports";

export interface Documentation {
  readonly config: SiteConfig;
  readonly processes: readonly Process[];
  readonly pages: readonly DocPage[];
  readonly scenes: readonly Scene[];
}

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
