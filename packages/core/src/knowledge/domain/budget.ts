// Results an agent reads are bounded (spec 003, principle 3.1.3): about 6,000 tokens, measured
// as characters of JSON so the check needs no tokenizer. Larger results are trimmed, most
// relevant first, and say what was left out.
export const RESULT_BUDGET = 24_000;

export const sizeOf = (value: unknown): number => JSON.stringify(value).length;

// The result built with the largest list limit (from `start`, shrinking) that fits the budget.
export function fitted<T>(build: (limit: number) => T, start: number): T {
  let limit = start;
  let value = build(limit);
  while (sizeOf(value) > RESULT_BUDGET && limit > 1) {
    limit = Math.max(1, Math.floor(limit * 0.7));
    value = build(limit);
  }
  return value;
}
