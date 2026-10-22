import { NoDocumentationError } from "../domain/errors";
import { parseFeatures } from "../domain/features";
import { parseDocPage } from "../domain/page";
import { parseProcess } from "../domain/process";
import { parseQuestions } from "../domain/questions";
import { parseRelease } from "../domain/releases";
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
  const releases = ((await sources.releases?.()) ?? []).map((source) =>
    parseRelease(source.path, source),
  );
  const features = ((await sources.features?.()) ?? []).map((source) =>
    parseFeatures(source.path, source.features),
  );
  const questions = ((await sources.questions?.()) ?? []).map((source) =>
    parseQuestions(source.path, source.questions),
  );
  return { config, processes, pages, scenes, releases, features, questions };
}
