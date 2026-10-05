# S4. Parsing real ServiceNow scripts

- Date: 2026-10-05
- Confirms: ADR-0005 (JavaScript tooling), ADR-0006 (ESLint rule API for script rules)
- Verdict: **go.** 0.24% of files do not parse, and every one of them is understood.

## Question

Can espree, the parser behind ESLint, parse the scripts of a real instance well enough to
build governance rules on it?

## Corpus and method

- Every exploded `.js` file in the v1 mirror of the PDI on this machine: **83,806 files**
  across all script-bearing fields of 279,983 records, most of them ServiceNow out-of-box
  code. The corpus stays outside the repository; only aggregates are recorded here.
- `tools/spikes/s4-parse-corpus/parse-corpus.ts` parses every file with
  `ecmaVersion: latest`, `sourceType: script`. On failure it tries, in order:
  1. top-level `return` allowed;
  2. the content is JSON;
  3. the content is a function expression (`function (…) {…}`), which ServiceNow wraps
     itself;
  4. an ES module.

  The whole corpus parses in about 17 seconds.

## Results

| Outcome | Files | Share |
|---|---|---|
| Parsed as a script | 82,888 | 98.90% |
| Function expression (Service Portal client scripts, Angular providers, CI identifiers, diagram shapes) | 388 | 0.46% |
| JSON, not script (widget instance parameters) | 297 | 0.35% |
| ES module (UI Builder / npm module content) | 34 | 0.04% |
| Top-level `return` needed | 0 | 0% |
| **Not parseable** | **199** | **0.24%** |

Of the scripts that parse as scripts, 69,983 (84%) use only ES5 syntax; 16% use ES2015+
syntax.

## The 199 unparseable files

| Group | Files | Examples | What the product should do |
|---|---|---|---|
| Invalid placeholders and templates as stored | ~185 | Permit-rule template whose body is prose (138); default templates with collapsed line breaks, where `// Add your code here` comments out the closing brackets (remote tables, Flow Designer calculations, diagram handlers, UI actions, business rules) | Report as a syntax finding. Usually inactive or never-edited out-of-box records |
| Rhino-only syntax (accepted by ServiceNow's legacy engine) | 2 | Java anonymous class `new Packages.java.lang.Runnable() { run: … }`; conditional catch `catch (ex if ex instanceof X)` | Report as an upgradability finding ("non-standard Rhino syntax"), not as a parser crash |
| Real syntax bugs in shipped code | ~7 | Missing comma in an object literal; missing `+` in a string concatenation; unbalanced parenthesis in a business rule; zero-width space inside code; widget scripts with errors further down | Report as a syntax finding with the parser's message and line |
| Not individually inspected | 5 | UI Builder client scripts (`sys_ux_client_script`) failing on `:`, `?`, `]` or an unterminated string | Inspect in phase 2 when the UI Builder artifact type is defined |

Group sizes other than the permit-rule template (138) are approximate: they come from
reading the error list and a sample of files, not from an automated classification.

## Consequences for the design

1. **The parse mode belongs to the field, not the file.** The `ArtifactType` registry
   (ADR-0001, ADR-0006) must record, for each script field, whether it is a *script*, a
   *function expression*, *JSON* or a *module*, and which runtime it targets (server,
   client, portal).
2. **"Does not parse" is a finding, not an error.** The rule engine needs a built-in rule
   (for example `SN-SYNTAX-001`) that reports the parser message and line. It found real
   bugs in shipped code in this corpus.
3. **Rhino extensions** get a dedicated upgradability rule, recognized by the parser
   error. No tolerant parser is needed: two files in the whole corpus.

## Caveat

This corpus is mostly out-of-box code from one PDI. Customer instances contain more custom
code. The failure groups are expected to be the same, but phase 2 should re-run this spike
on a customer mirror before release.
