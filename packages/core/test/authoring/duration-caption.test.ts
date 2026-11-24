import { describe, expect, it } from "bun:test";
import { durationCaptionAgrees } from "../../src/authoring/domain/duration-caption";

describe("the caption of a duration", () => {
  it("agrees when it names the stored duration", () => {
    expect(durationCaptionAgrees("1970-01-01 00:00:30", "30 Seconds")).toBe(true);
    expect(durationCaptionAgrees("1970-01-01 00:00:01", "1 Second")).toBe(true);
    expect(durationCaptionAgrees("1970-01-01 01:30:00", "1 Hour 30 Minutes")).toBe(true);
    expect(durationCaptionAgrees("1970-01-03 04:00:05", "2 Days 4 Hours 5 Seconds")).toBe(true);
  });

  it("refuses a caption that names another duration", () => {
    expect(durationCaptionAgrees("1970-01-01 00:00:30", "45 Seconds")).toBe(false);
    expect(durationCaptionAgrees("1970-01-01 00:00:30", "30 Minutes")).toBe(false);
    expect(durationCaptionAgrees("1970-01-01 01:30:00", "1 Hour")).toBe(false);
  });

  it("refuses a caption it cannot read", () => {
    for (const caption of [
      "",
      "soon",
      "30",
      "30 seconds",
      "30 Second",
      "1 Seconds",
      "0 Seconds",
      "30 Seconds 1 Minute",
      "1 Minute 1 Minute",
      "30  Seconds",
      "1.5 Hours",
    ])
      expect(durationCaptionAgrees("1970-01-01 00:00:30", caption)).toBe(false);
  });

  it("refuses a stored value that is not a duration it can read", () => {
    expect(durationCaptionAgrees("1970-02-01 00:00:00", "31 Days")).toBe(false);
    expect(durationCaptionAgrees("30", "30 Seconds")).toBe(false);
    expect(durationCaptionAgrees("1970-01-01 00:00:00", "0 Seconds")).toBe(false);
    expect(durationCaptionAgrees("1970-01-01 25:00:00", "25 Hours")).toBe(false);
  });
});
