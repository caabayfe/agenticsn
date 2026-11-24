const UNITS: readonly (readonly [string, number])[] = [
  ["Day", 86_400],
  ["Hour", 3_600],
  ["Minute", 60],
  ["Second", 1],
];

// A duration is stored as the time since 1970-01-01 00:00:00. Thirty-one days or more roll
// into the month, which no capture has recorded: those are not read.
function storedSeconds(value: string): number | null {
  const match = /^1970-01-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (match === null) return null;
  const [day = 0, hours = 0, minutes = 0, seconds = 0] = match.slice(1).map(Number);
  if (day < 1 || day > 31 || hours > 23 || minutes > 59 || seconds > 59) return null;
  return (day - 1) * 86_400 + hours * 3_600 + minutes * 60 + seconds;
}

// The platform's caption of a duration: "30 Seconds", "1 Hour 30 Minutes". Each unit at most
// once, largest first, singular for one.
function captionSeconds(caption: string): number | null {
  const words = caption.split(" ");
  if (words.length === 0 || words.length % 2 !== 0) return null;
  let total = 0;
  let next = 0;
  for (let index = 0; index < words.length; index += 2) {
    const amount = words[index] ?? "";
    const word = words[index + 1] ?? "";
    if (!/^[1-9]\d*$/.test(amount)) return null;
    const unit = UNITS.findIndex(
      ([name], at) => at >= next && word === (amount === "1" ? name : `${name}s`),
    );
    const size = UNITS[unit]?.[1];
    if (size === undefined) return null;
    total += Number(amount) * size;
    next = unit + 1;
  }
  return total;
}

// A caption is display only, but it has to name the duration that runs.
export function durationCaptionAgrees(value: string, caption: string): boolean {
  const stored = storedSeconds(value);
  return stored !== null && stored > 0 && stored === captionSeconds(caption);
}
