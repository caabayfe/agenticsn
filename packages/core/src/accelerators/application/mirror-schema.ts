import { describeTable, type KnowledgeDependencies } from "../../knowledge/index";
import type { SchemaReader } from "../ports";

// The mirror's tables through the knowledge index: a table's fields, its parents' included
// (plan gap G13). The index opens on the first question, so a plan without fields never opens it.
export function mirrorSchema(open: () => Promise<KnowledgeDependencies>): SchemaReader {
  let session: Promise<KnowledgeDependencies> | null = null;
  const knowledge = () => {
    session ??= open();
    return session;
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
  };
}
