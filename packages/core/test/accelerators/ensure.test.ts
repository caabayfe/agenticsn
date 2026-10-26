import { describe, expect, it } from "bun:test";
import {
  type EnsureFact,
  ensureContainerSource,
  ensureEntryId,
  ensureFactsOf,
  ensureSource,
  factStatus,
  isListFact,
  type ListState,
} from "@snagentic/core";

// ADR-0042: a module states facts about layouts it does not own, found by table and view.

const FACT: EnsureFact = {
  capability: "incident-relations",
  kind: "related_list",
  table: "incident",
  view: "Default view",
  list: "incident_task.incident",
  note: "Incident Tasks on the incident form",
};

const CONTAINER = "454c3bdf53853010ae50ddeeff7b1263";
const OURS = ensureEntryId("itsm", FACT);

const state = (entries: ListState["entries"], container: string | null = CONTAINER): ListState => ({
  container,
  view: "Default view",
  entries,
});

describe("reading ensure.yaml (ADR-0042)", () => {
  it("reads related list facts, naming the module", () => {
    const problems: string[] = [];
    const facts = ensureFactsOf(
      "incident-relations",
      "modules/incident-relations/ensure.yaml",
      [
        {
          kind: "related_list",
          table: "incident",
          view: "Default view",
          list: "incident_task.incident",
          note: "Incident Tasks",
        },
      ],
      problems,
    );
    expect(problems).toEqual([]);
    expect(facts).toEqual([{ ...FACT, note: "Incident Tasks" }]);
  });

  it("names each entry it cannot use: an unknown kind, or a missing table, view, list or note", () => {
    const problems: string[] = [];
    const facts = ensureFactsOf(
      "m",
      "modules/m/ensure.yaml",
      [
        { kind: "form_section", table: "incident" },
        { kind: "related_list", table: "incident" },
        "x",
      ],
      problems,
    );
    expect(facts).toEqual([]);
    expect(problems).toEqual([
      "modules/m/ensure.yaml: entry 1 kind can only be related_list or form_field",
      "modules/m/ensure.yaml: entry 2 needs table, view, list and note",
      "modules/m/ensure.yaml: entry 3 needs table, view, list and note",
    ]);
    const notAList: string[] = [];
    ensureFactsOf("m", "modules/m/ensure.yaml", { kind: "related_list" }, notAList);
    expect(notAList).toEqual([
      "modules/m/ensure.yaml: a list of { kind, table, view, list or field, note }",
    ]);
  });
});

describe("what a fact needs on the instance", () => {
  it("is missing when the view's lists do not include it", () => {
    expect(
      factStatus(FACT, state([{ sysId: "e1", relatedList: "task_sla.task", position: 0 }]), OURS),
    ).toBe("missing");
  });

  it("is already true when someone else's entry lists it, and ours when the module's entry does", () => {
    expect(
      factStatus(FACT, state([{ sysId: "e1", relatedList: FACT.list, position: 3 }]), OURS),
    ).toBe("present");
    expect(
      factStatus(FACT, state([{ sysId: OURS, relatedList: FACT.list, position: 9 }]), OURS),
    ).toBe("ours");
  });

  it("has no target when the instance has no list layout for that table and view", () => {
    expect(factStatus(FACT, state([], null), OURS)).toBe("absent");
  });
});

describe("the Fluent a module's facts become", () => {
  it("adds each missing list after the lists already there, naming the container it adds to", () => {
    const other = {
      ...FACT,
      list: "REL:6e7493c9f6816bf9a6e71b9603029dac",
      note: "Related Changes",
    };
    const lists = state([
      { sysId: "e1", relatedList: "task_sla.task", position: 0 },
      { sysId: "e2", relatedList: "kb_knowledge.source", position: 6 },
    ]);
    const source = ensureSource("itsm", "incident-relations", [
      { fact: FACT, state: lists },
      { fact: other, state: lists },
    ]);
    expect(source.containers).toEqual([
      { sysId: CONTAINER, table: "incident", view: "Default view" },
    ]);
    expect(source.text).toContain(
      `data: { list_id: '${CONTAINER}', related_list: 'incident_task.incident', position: 7 }`,
    );
    expect(source.text).toContain(
      `data: { list_id: '${CONTAINER}', related_list: 'REL:6e7493c9f6816bf9a6e71b9603029dac', position: 8 }`,
    );
    expect(source.text).toContain(`$id: '${OURS}'`);
  });

  it("restates a container in its own source, so modules adding to one layout never declare it twice", () => {
    const lists = state([{ sysId: "e1", relatedList: "task_sla.task", position: 0 }]);
    const relations = ensureSource("itsm", "incident-relations", [{ fact: FACT, state: lists }]);
    const outage = ensureSource("itsm", "incident-outage", [
      { fact: { ...FACT, capability: "incident-outage", list: "task_outage.task" }, state: lists },
    ]);
    for (const source of [relations, outage]) {
      expect(source.text).not.toContain(`$id: '${CONTAINER}'`);
    }
    const container = ensureContainerSource({
      sysId: CONTAINER,
      table: "incident",
      view: "Default view",
    });
    expect(container).toContain(`$id: '${CONTAINER}'`);
    expect(container).toContain("table: 'sys_ui_related_list'");
    expect(container).toContain("data: { name: 'incident', view: 'Default view' }");
  });

  it("keeps the module's own entry where it is, and leaves out facts already true or without a target", () => {
    const kept = ensureSource("itsm", "incident-relations", [
      { fact: FACT, state: state([{ sysId: OURS, relatedList: FACT.list, position: 4 }]) },
    ]);
    expect(kept.text).toContain("related_list: 'incident_task.incident', position: 4 }");
    const none = ensureSource("itsm", "incident-relations", [
      { fact: FACT, state: state([{ sysId: "e9", relatedList: FACT.list, position: 1 }]) },
      { fact: { ...FACT, table: "problem" }, state: state([], null) },
    ]);
    expect(none).toEqual({ text: "", containers: [] });
  });

  it("keeps an entry id the module gave before, so moving a list to ensure.yaml recreates nothing", () => {
    const problems: string[] = [];
    const [kept] = ensureFactsOf(
      "incident-relations",
      "modules/incident-relations/ensure.yaml",
      [{ ...FACT, kind: "related_list", id: "3ca1ca8f29547f4dc1502e09484e17e7" }],
      problems,
    );
    expect(kept && isListFact(kept) && ensureEntryId("itsm", kept)).toBe(
      "3ca1ca8f29547f4dc1502e09484e17e7",
    );
    ensureFactsOf(
      "m",
      "modules/m/ensure.yaml",
      [{ ...FACT, kind: "related_list", id: "nope" }],
      problems,
    );
    expect(problems).toEqual([
      "modules/m/ensure.yaml: entry 1 id must be a sys_id (32 hexadecimal characters)",
    ]);
  });

  it("gives each fact the same entry id wherever the pack is installed", () => {
    expect(ensureEntryId("itsm", FACT)).toBe(ensureEntryId("itsm", { ...FACT, note: "changed" }));
    expect(ensureEntryId("itsm", FACT)).not.toBe(ensureEntryId("itsm", { ...FACT, view: "sow" }));
    expect(ensureEntryId("itsm", FACT)).toMatch(/^[0-9a-f]{32}$/);
  });
});
