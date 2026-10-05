export interface TimingSummary {
  readonly runs: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

function roundToTenth(milliseconds: number): number {
  return Math.round(milliseconds * 10) / 10;
}

// Nearest-rank percentile over the sorted samples.
function percentile(sorted: readonly number[], fraction: number): number {
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[rank - 1] ?? Number.NaN;
}

export function summarizeTimings(samples: readonly number[]): TimingSummary {
  if (samples.length === 0) {
    throw new Error("timing summary needs at least one sample");
  }
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    runs: sorted.length,
    p50: roundToTenth(percentile(sorted, 0.5)),
    p95: roundToTenth(percentile(sorted, 0.95)),
    max: roundToTenth(percentile(sorted, 1)),
  };
}
