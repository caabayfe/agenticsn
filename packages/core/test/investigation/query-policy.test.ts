import { expect, it } from "bun:test";
import { assertSelectiveQuery, parseLiveQuery } from "../../src/investigation/domain/query-policy";

it("parses OR as adjacent alternatives within AND, and NQ as whole groups", () => {
  const parsed = parseLiveQuery("active=true^priority=1^ORpriority=2^NQactive=false^priority=3");
  expect(
    parsed.map((group) =>
      group.map((clause) => clause.map((term) => `${term.field}=${term.value}`)),
    ),
  ).toEqual([
    [["active=true"], ["priority=1", "priority=2"]],
    [["active=false"], ["priority=3"]],
  ]);
});

it("requires a bounded indexed anchor in every boolean branch", () => {
  expect(() => assertSelectiveQuery(parseLiveQuery("sys_id=a^ORactive=true"), [])).toThrow();
  expect(() =>
    assertSelectiveQuery(parseLiveQuery("sys_id=a^active=true^ORactive=false"), []),
  ).not.toThrow();
  expect(() =>
    assertSelectiveQuery(
      parseLiveQuery(
        "sys_updated_on>=2026-11-01 00:00:00^sys_updated_on<2026-11-08 00:00:00^active=true",
      ),
      [],
    ),
  ).not.toThrow();
  for (const query of [
    "sys_updated_on>=2026-01-01 00:00:00^sys_updated_on<2026-11-08 00:00:00",
    "sys_updated_on>=2026-11-01",
    "sys_id=a^NQactive=true",
    "sys_idNOT INa",
    "sys_updated_on>=2026-02-31 00:00:00^sys_updated_on<2026-03-04 00:00:00",
    "sys_updated_on>=2026-11-01 24:00:00^sys_updated_on<2026-11-03 00:00:00",
    "sys_idINa,",
  ])
    expect(() => assertSelectiveQuery(parseLiveQuery(query), [])).toThrow();
});

it("rejects control tokens, script expressions, empty operators with values and unsupported filters", () => {
  for (const query of [
    "sys_id=a^ORDERBYnumber",
    "sys_id=a^EQ",
    "sys_id=a^^active=true",
    "activeISEMPTYfalse",
    "sys_updated_on>javascript:gs.now()",
    "nameLIKEhello",
    "name=bad\n",
    "^ORname=a",
  ])
    expect(() => parseLiveQuery(query)).toThrow();
});
