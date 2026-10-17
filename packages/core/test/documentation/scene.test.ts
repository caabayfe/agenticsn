import { describe, expect, it } from "bun:test";
import {
  DocumentationSourceError,
  estimateTimeline,
  parseScene,
  playerHtml,
  revealCss,
} from "@snagentic/core";

const SVG = '<svg viewBox="0 0 960 600" role="img"><g id="cam"><rect class="r g0"/></g></svg>';

function scene(overrides: { animation?: object; steps?: unknown; svg?: string } = {}) {
  return parseScene("animations/tri", {
    animation: {
      name: "tri",
      title: "Triage cases",
      heading: "From a call or an email to the right ticket",
      tags: [["obs", "Observed in the mirror · 17 Oct 2026"]],
      vb: [960, 600],
      foot: "Observed in the mirror of pdi2.",
      ...overrides.animation,
    },
    svg: overrides.svg ?? SVG,
    css: ".x{fill:red}",
    steps: overrides.steps ?? [
      {
        t: "Two ways in",
        c: "A <b>call</b> or an email.",
        say: "one two three four",
        cam: [1.5, 150, 140],
      },
      {
        t: "Take it",
        c: "Assign to me.",
        say: "five",
        sub: "Five.",
        on: "flow('tk0','p_in',1500,500,true)",
      },
    ],
  });
}

describe("scenes", () => {
  it("reads the scene files of an animation", () => {
    const parsed = scene();
    expect(parsed.name).toBe("tri");
    expect(parsed.vb).toEqual([960, 600]);
    expect(parsed.tags).toEqual([{ kind: "obs", text: "Observed in the mirror · 17 Oct 2026" }]);
    expect(parsed.steps[0]).toEqual({
      t: "Two ways in",
      c: "A <b>call</b> or an email.",
      say: "one two three four",
      sub: "one two three four",
      cam: [1.5, 150, 140],
    });
    expect(parsed.steps[1]?.on).toBe("flow('tk0','p_in',1500,500,true)");
  });

  it("uses the engine's default viewBox when none is given", () => {
    expect(scene({ animation: { vb: undefined } }).vb).toEqual([960, 440]);
  });

  it("refuses a scene whose name is not its folder", () => {
    expect(() => scene({ animation: { name: "other" } })).toThrow(DocumentationSourceError);
  });

  it("refuses a scene without steps", () => {
    expect(() => scene({ steps: [] })).toThrow(/at least one step/);
  });

  it("refuses a step without narration text", () => {
    expect(() => scene({ steps: [{ t: "A", c: "B" }] })).toThrow(/step 1.*say/);
  });

  it("refuses an SVG without the camera group", () => {
    expect(() => scene({ svg: "<svg></svg>" })).toThrow(/id="cam"/);
  });

  it("refuses a camera that is not [scale, x, y]", () => {
    expect(() => scene({ steps: [{ t: "A", c: "B", say: "C", cam: [1, 2] }] })).toThrow(/cam/);
  });
});

describe("timeline without narration", () => {
  it("gives each step max(4.2, words / 2.55 + 1.5) seconds, from 0.6 s, plus a 1.6 s tail", () => {
    const steps = scene().steps;
    const timeline = estimateTimeline(steps);
    const first = Math.max(4.2, 4 / 2.55 + 1.5);
    expect(timeline.starts).toEqual([0.6, 0.6 + first]);
    expect(timeline.total).toBeCloseTo(0.6 + first + 4.2 + 1.6, 6);
  });
});

describe("player page", () => {
  it("reveals the elements of steps 0..k from step k on", () => {
    expect(revealCss(3)).toBe(".s0 .g0,.s1 .g1,.s2 .g2{opacity:1;transform:none}\n");
  });

  it("is one self-contained page with the scene, its steps and no external request", () => {
    const html = playerHtml(scene());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Triage cases</title>");
    expect(html).toContain(SVG);
    expect(html).toContain(".x{fill:red}");
    expect(html).toContain('"t":"Two ways in"');
    expect(html).toContain("on:()=>{flow('tk0','p_in',1500,500,true)}");
    expect(html).toContain("Player({vb:[960,600],steps:");
    expect(html).not.toMatch(/(src|href)="https?:/);
  });

  it("is silent when it has no audio track: no source on the audio element", () => {
    const html = playerHtml(scene());
    expect(html).toContain('<audio id="au" preload="auto"></audio>');
    expect(html).not.toContain("window.TIMING=");
  });

  it("embeds an audio track and its timing when given", () => {
    const html = playerHtml(scene(), {
      audio: { mimeType: "audio/mpeg", base64: "AAAA" },
      timeline: { starts: [0.7, 9.1], total: 15.2 },
    });
    expect(html).toContain(
      '<audio id="au" preload="auto" src="data:audio/mpeg;base64,AAAA"></audio>',
    );
    expect(html).toContain('window.TIMING={"starts":[0.7,9.1],"total":15.2};');
  });

  it("cannot be broken out of by step text that closes the script", () => {
    const html = playerHtml(scene({ steps: [{ t: "</script><b>x", c: "c", say: "s" }] }));
    expect(html).not.toContain("</script><b>x");
  });
});
