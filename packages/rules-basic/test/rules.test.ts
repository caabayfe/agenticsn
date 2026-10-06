import { describe, expect, it } from "bun:test";
import { RULES } from "@snagentic/core";
import { SCRIPT_RULES } from "../src/index";
import { lint } from "./lint";

// [rule, record settings, triggering sample, passing sample] (AGENTS.md: one of each at least).
const CASES: [string, Record<string, string>, string, string][] = [
  ["SN-SEC-001", {}, "eval(input);", "handlers[input]();"],
  ["SN-SEC-001", {}, "var f = new Function('a', body);", "var f = function (a) { return a; };"],
  [
    "SN-SEC-002",
    {},
    "var password = 'S3cr3t!pass';",
    "var password = gs.getProperty('x.api.password');",
  ],
  ["SN-SEC-002", {}, "r.setBasicAuth('svc', 'hunter2!');", "r.setBasicAuth(user, pass);"],
  [
    "SN-SEC-002",
    {},
    "r.setRequestHeader('Authorization', 'Bearer abcdef123456');",
    "r.setRequestHeader('Accept', 'application/json');",
  ],
  [
    "SN-SEC-003",
    {},
    "gr.addEncodedQuery('active=true^caller_id=' + userId);",
    "gr.addEncodedQuery('active=true^priority=1');",
  ],
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the sample is JavaScript source.
  ["SN-SEC-003", {}, "gr.addEncodedQuery(`state=${state}`);", "gr.addQuery('state', state);"],
  [
    "SN-SEC-004",
    { className: "sys_security_acl" },
    "answer = true;",
    "answer = gs.hasRole('itil');",
  ],
  [
    "SN-SEC-005",
    {},
    "var f = new Packages.java.io.File('/tmp');",
    "var f = new GlideSysAttachment();",
  ],
  [
    "SN-PERF-001",
    { when: "before" },
    "current.priority = 1;\ncurrent.update();",
    "current.priority = 1;",
  ],
  ["SN-PERF-001", { when: "after" }, "current.update();", "var other = new GlideRecord('task');"],
  [
    "SN-PERF-002",
    {},
    "while (gr.next()) {\n  var t = new GlideRecord('task');\n}",
    "var t = new GlideRecord('task');\nt.addQuery('parent', 'IN', ids);",
  ],
  [
    "SN-PERF-002",
    {},
    "ids.forEach(function (id) { var g = new GlideAggregate('task'); });",
    "var g = new GlideAggregate('task');",
  ],
  ["SN-PERF-003", {}, "if (gr.getRowCount() > 0) {}", "if (gr.hasNext()) {}"],
  ["SN-PERF-004", {}, "gs.sleep(1000);", "gs.eventQueue('x.ready', current);"],
  ["SN-PERF-005", {}, "var gr = new GlideRecord('incident');", "var ga = new GlideAjax('MyUtil');"],
  ["SN-PERF-006", {}, "ga.getXMLWait();", "ga.getXMLAnswer(callback);"],
  [
    "SN-PERF-006",
    {},
    "var u = g_form.getReference('caller_id');",
    "g_form.getReference('caller_id', function (u) {});",
  ],
  [
    "SN-PERF-007",
    { when: "before" },
    "var r = new sn_ws.RESTMessageV2('Jira', 'post');",
    "gs.eventQueue('jira.push', current);",
  ],
  [
    "SN-UPG-001",
    {},
    "document.getElementById('x').style.display = 'none';",
    "g_form.setDisplay('x', false);",
  ],
  ["SN-UPG-001", {}, "$('x').hide();", "var cart = window.$location;"],
  [
    "SN-MNT-001",
    {},
    "gr.get('9d385017c611228701d22104cc95c371');",
    "gr.get(gs.getProperty('x.default_group'));",
  ],
  [
    "SN-MNT-002",
    {},
    "var url = 'https://acme.service-now.com/incident.do';",
    "var url = gs.getProperty('glide.servlet.uri') + 'incident.do';",
  ],
  [
    "SN-MNT-002",
    {},
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the sample is JavaScript source.
    "var url = `https://acme.service-now.com/${table}.do`;",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the sample is JavaScript source.
    "var url = `${base}${table}.do`;",
  ],
  ["SN-MNT-003", { scoped: "true" }, "gs.log('started');", "gs.info('started');"],
  ["SN-MNT-004", {}, "gr.setWorkflow(false);", "gr.setWorkflow(true);"],
  [
    "SN-MNT-005",
    { name: "IncidentUtil" },
    "var IncidentUtils = Class.create();",
    "var IncidentUtil = Class.create();",
  ],
  [
    "SN-MNT-005",
    { name: "IncidentUtil" },
    "IncidentUtils = Class.create();",
    "IncidentUtil = Class.create();",
  ],
  [
    "SN-UX-001",
    { type: "onChange" },
    "function onChange(c, o, n) { g_form.setValue('x', n); }",
    "function onChange(c, o, n, isLoading) { if (isLoading) { return; } }",
  ],
  [
    "SN-UX-002",
    { type: "onLoad" },
    "function onLoad() { g_form.setMandatory('x', true); }",
    "function onLoad() { var ga = new GlideAjax('U'); g_form.setMandatory('x', true); }",
  ],
  ["SN-UX-003", {}, "alert('Saved');", "g_form.addInfoMessage('Saved');"],
];

describe("script rules", () => {
  it.each(CASES)(
    "%s reports the triggering sample and not the passing one",
    (id, record, bad, good) => {
      expect(lint(id, bad, record).length).toBeGreaterThan(0);
      expect(lint(id, good, record)).toEqual([]);
    },
  );

  it("reports the line of the problem", () => {
    expect(
      lint("SN-PERF-001", "current.priority = 1;\ncurrent.update();", { when: "before" }),
    ).toEqual([2]);
  });

  it("leaves rules that depend on the record alone when the record does not match", () => {
    expect(lint("SN-PERF-001", "current.update();", { when: "async" })).toEqual([]);
    expect(lint("SN-MNT-003", "gs.log('x');", { scoped: "false" })).toEqual([]);
    expect(lint("SN-UX-001", "function onLoad() {}", { type: "onLoad" })).toEqual([]);
  });

  it("implements every script rule of the catalog, and nothing else", () => {
    const scriptRules = RULES.filter((rule) => rule.scripts.length > 0)
      .map((rule) => rule.id)
      .sort();
    expect(Object.keys(SCRIPT_RULES).sort()).toEqual(scriptRules);
  });

  it("has a triggering and a passing sample for every rule", () => {
    expect([...new Set(CASES.map(([id]) => id))].sort()).toEqual(Object.keys(SCRIPT_RULES).sort());
  });
});
