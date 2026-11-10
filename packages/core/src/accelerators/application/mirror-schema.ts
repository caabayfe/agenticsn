import { describeTable, type KnowledgeDependencies } from "../../knowledge/index";
import type { SchemaReader } from "../ports";

// The mirror's tables through the knowledge index: a table's fields, its parents' included
// (plan gap G13). The index opens on the first question, so a plan without fields never opens it.
// The caller closes it when done, which closes the index it opened.
export function mirrorSchema(
  open: () => Promise<KnowledgeDependencies>,
): SchemaReader & { close(): Promise<void> } {
  let session: Promise<KnowledgeDependencies> | null = null;
  const knowledge = () => {
    session ??= open();
    return session;
  };
  const close = async () => {
    const opened = session;
    session = null;
    // A session that failed to open closed its own index.
    (await opened?.catch(() => null))?.store.close();
  };
  return {
    ready: async () => {
      const catalog = (await knowledge()).catalog;
      return catalog !== null && Object.keys(catalog.parents).length > 0;
    },
    fieldsOf: async (table) => {
      const description = await describeTable(await knowledge(), table);
      return description.known ? description.fields.map((f) => f.name) : null;
    },
    refresh: () => {
      void close();
    },
    close,
  };
}
