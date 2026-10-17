// From a screencast (frames pushed when the picture changes, each with its wall-clock time) to
// the ffmpeg concat list of a video of exactly `total` seconds from `start`.

export interface CapturedFrame {
  readonly file: string;
  // Seconds, same clock as `start`.
  readonly timestamp: number;
}

export interface FrameEntry {
  readonly file: string;
  readonly duration: number;
}

export function frameSchedule(
  frames: readonly CapturedFrame[],
  start: number,
  total: number,
): readonly FrameEntry[] {
  const sorted = [...frames].sort((a, b) => a.timestamp - b.timestamp);
  // The picture at time 0 is the last frame pushed at or before the start.
  const before = sorted.filter((frame) => frame.timestamp <= start);
  const first = before[before.length - 1] ?? sorted[0];
  if (first === undefined) {
    return [];
  }
  const after = sorted.filter(
    (frame) => frame !== first && frame.timestamp > start && frame.timestamp < start + total,
  );
  const timeline = [
    { file: first.file, at: 0 },
    ...after.map((frame) => ({ file: frame.file, at: frame.timestamp - start })),
  ];
  return timeline.map((frame, index) => ({
    file: frame.file,
    duration: Math.max(0.001, (timeline[index + 1]?.at ?? total) - frame.at),
  }));
}

// The concat demuxer's input: each file with its duration, the last repeated (ffmpeg ignores
// the last duration otherwise).
export function concatList(entries: readonly FrameEntry[]): string {
  const lines = entries.flatMap((entry) => [
    `file '${entry.file}'`,
    `duration ${entry.duration.toFixed(4)}`,
  ]);
  const last = entries[entries.length - 1];
  const all = [...lines, ...(last === undefined ? [] : [`file '${last.file}'`])];
  return `${all.join("\n")}\n`;
}
