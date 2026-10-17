// The player's CSS (ported from the SNDOC engine v2, "camera-fit"). Design tokens, stage,
// reveal transitions, captions, subtitles and controls; reduced motion removes all motion.
export const PLAYER_STYLE = `:root{--ink:#172B4D;--ink2:#44546F;--mute:#8590A2;--line:#DCDFE4;--bg:#FFFFFF;--panel:#F7F8F9;
--blue:#0C66E4;--blueL:#E9F2FF;--navy:#0B2545;--teal:#1F845A;--tealL:#DCFFF1;--amber:#B65C02;--amberL:#FFF7D6;
--red:#C9372C;--redL:#FFECEB;--purple:#6E5DC6;--purpleL:#F3F0FF;--grey:#626F86;--greyL:#F1F2F4;
--ease:cubic-bezier(.22,.8,.24,1);color-scheme:only light}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 "Segoe UI",-apple-system,Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:1000px;margin:0 auto;padding:10px 12px 8px}
.hdr{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin:0 0 6px}
.hdr h3{margin:0;font-size:16px;font-weight:650}
.tag{font-size:11px;font-weight:650;letter-spacing:.03em;text-transform:uppercase;padding:2px 7px;border-radius:3px}
.tag.obs{background:var(--tealL);color:var(--teal)} .tag.con{background:var(--purpleL);color:var(--purple)} .tag.src{background:var(--blueL);color:var(--blue)}
.stage{position:relative;border:1px solid var(--line);border-radius:10px;background:linear-gradient(180deg,#fff,#FAFBFC);overflow:hidden}
.stage svg{display:block;width:100%;height:auto}
svg text{font-family:"Segoe UI",-apple-system,Roboto,Helvetica,Arial,sans-serif;fill:var(--ink)}
#cam{transform-box:view-box;transform-origin:0 0;transition:transform 1.8s var(--ease);will-change:transform}
.r{opacity:0;transform:translateY(8px);transform-box:fill-box;transform-origin:center;transition:opacity .9s var(--ease),transform .9s var(--ease);transition-delay:var(--d,0s)}
.hl{transition:fill .7s var(--ease),stroke .7s var(--ease),opacity .7s var(--ease),stroke-width .7s var(--ease)}
.tok{opacity:0}
@keyframes pulse{0%,100%{opacity:.35}50%{opacity:.9}}
@keyframes dash{to{stroke-dashoffset:-40}}
.subt{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);max-width:88%;padding:6px 12px;border-radius:6px;background:rgba(11,37,69,.86);color:#fff;font-size:13.5px;line-height:1.35;text-align:center;opacity:0;transition:opacity .35s;pointer-events:none}
.subt.on{opacity:1}
.cap{min-height:64px;margin-top:8px;padding:8px 12px;border-left:3px solid var(--blue);background:var(--panel);border-radius:0 6px 6px 0;transition:border-color .4s}
.cap > b{display:block;font-size:14px;margin-bottom:2px}
.cap span{color:var(--ink2);font-size:13.5px}
.ctl{display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap}
.ctl button{height:30px;min-width:34px;padding:0 10px;border:1px solid var(--line);background:#fff;border-radius:6px;color:var(--ink);font:600 13px "Segoe UI",Roboto,Arial,sans-serif;cursor:pointer;white-space:nowrap}
.ctl button:hover,.ctl button:focus-visible{border-color:var(--blue);outline:none;color:var(--blue)}
.ctl button.pri{background:var(--navy);border-color:var(--navy);color:#fff}
.ctl button.pri:hover{color:#fff;background:var(--blue);border-color:var(--blue)}
.ctl button.on{background:var(--blueL);border-color:var(--blue);color:var(--blue)}
.bar{position:relative;flex:1;min-width:140px;height:22px;cursor:pointer}
.bar .tr{position:absolute;left:0;right:0;top:9px;height:4px;border-radius:2px;background:var(--line)}
.bar .fi{position:absolute;left:0;top:9px;height:4px;border-radius:2px;background:var(--blue);width:0}
.bar i{position:absolute;top:6px;width:2px;height:10px;background:#fff;border-left:1px solid #B3B9C4}
.bar .kn{position:absolute;top:5px;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:var(--navy);box-shadow:0 0 0 3px rgba(12,102,228,.18)}
.tm{font-size:12px;color:var(--mute);min-width:74px;text-align:right;font-variant-numeric:tabular-nums}
.foot{margin-top:6px;font-size:11.5px;color:var(--mute)}
.record .ctl{display:none}
@media (prefers-reduced-motion: reduce){#cam,.r,.hl{transition:none!important}*{animation:none!important}}
`;

// Shapes every scene can use: edges, labels and boxes.
export const SCENE_BASE_STYLE = `
.e{fill:none;stroke:#8590A2;stroke-width:1.5}
.ea{fill:none;stroke:var(--amber);stroke-width:1.6;stroke-dasharray:6 4;animation:dash 1.4s linear infinite}
.eg{fill:none;stroke:var(--teal);stroke-width:1.6;stroke-dasharray:6 4;animation:dash 1.4s linear infinite}
.lbl{font-size:10.5px;fill:var(--ink2)} .lbl.b{font-weight:700;fill:var(--ink)} .lbl.a{fill:var(--amber)} .lbl.g{fill:var(--teal)} .lbl.r2{fill:var(--red)} .lbl.bl{fill:var(--blue)}
.lbl.m{text-anchor:middle} .lbl.e2{text-anchor:end}
.box rect{fill:#fff;stroke:var(--line);stroke-width:1.3}
`;
