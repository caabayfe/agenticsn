import { escapeHtml, scriptJson } from "./html";
import { PLAYER_SCRIPT } from "./player-script";
import { PLAYER_STYLE, SCENE_BASE_STYLE } from "./player-style";
import type { Scene, SceneStep, Timeline } from "./scene";

// An encoded audio track for the narrated mode (phase 2: music, effects, optional voice).
export interface PlayerAudio {
  readonly mimeType: string;
  readonly base64: string;
}

export interface PlayerMedia {
  readonly audio: PlayerAudio;
  // The step starts the track was mixed to; it replaces the estimate as the player's clock.
  readonly timeline: Timeline;
}

// .s0 .g0, …: step k reveals every element with class g0..gk.
export function revealCss(steps: number): string {
  const selectors = Array.from({ length: steps }, (_, k) => `.s${k} .g${k}`);
  return `${selectors.join(",")}{opacity:1;transform:none}\n`;
}

function stepLiteral(step: SceneStep): string {
  const data = scriptJson({
    t: step.t,
    c: step.c,
    say: step.say,
    sub: step.sub,
    cam: step.cam ?? null,
  });
  return step.on === undefined ? data : `${data.slice(0, -1)},on:()=>{${step.on}}}`;
}

function header(scene: Scene): string {
  const tags = scene.tags.map(
    (tag) => `<span class="tag ${tag.kind}">${escapeHtml(tag.text)}</span>`,
  );
  return `<h3>${escapeHtml(scene.heading)}</h3>${tags.join("")}`;
}

const CONTROLS =
  '<div class="ctl"><button id="prev" aria-label="Previous step" title="Previous step (←)">⏮</button>' +
  '<button id="play" class="pri" aria-label="Play or pause">❚❚</button>' +
  '<button id="next" aria-label="Next step" title="Next step (→)">⏭</button>' +
  '<div class="bar" id="bar" role="slider" aria-label="Timeline"><div class="tr"></div>' +
  '<div class="fi" id="fi"></div><div class="kn" id="kn"></div></div><span class="tm" id="tm"></span>' +
  '<button id="listen" title="Restart with sound (M)">🔊 Listen with sound</button>' +
  '<button id="cc" class="on" title="Subtitles (C)">CC</button></div>';

// One self-contained page: the scene, the player and, when given, the audio track. It makes no
// request, so it works from a file, an iframe or any static server.
export function playerHtml(scene: Scene, media?: PlayerMedia): string {
  const audio =
    media === undefined ? "" : ` src="data:${media.audio.mimeType};base64,${media.audio.base64}"`;
  const timing = media === undefined ? "" : `window.TIMING=${scriptJson(media.timeline)};`;
  const steps = scene.steps.map(stepLiteral).join(",\n ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(scene.title)}</title>
<style>${PLAYER_STYLE}</style>
<style>${SCENE_BASE_STYLE}${scene.css}${revealCss(scene.steps.length)}</style><script>${timing}</script></head><body><div class="wrap">
<div class="hdr">${header(scene)}</div>
<div class="stage" id="stage">
${scene.svg}
<div class="subt" id="sub"></div>
</div>
<div class="cap" id="cap"></div>
${CONTROLS}
<audio id="au" preload="auto"${audio}></audio>
<div class="foot">${scene.foot}</div>
</div>
<script>${PLAYER_SCRIPT}</script>
<script>
Player({vb:${scriptJson(scene.vb)},steps:[
 ${steps}
]});
</script>
</body></html>
`;
}
