// The player (ported from the SNDOC engine v2, "camera-fit"), as browser JavaScript.
// - Clock: window.TIMING when the page has an audio track, otherwise the word-count estimate.
// - apply(k): stage classes s0..sk and at<k>, caption, camera, subtitle, the step's on().
// - fit(): a zoom never cuts the current step or a half-revealed box.
// - Autoplay muted when 35% of the stage is in view; loops after a 2.6 s hold.
// - Narrated mode (M): restarts with the audio as master clock and subtitles (C).
// - Keys: Space, arrows, M, C. Reduced motion shows the last step, without motion.
// - Height: posts {snagenticAnimH} to the embedding page.
export const PLAYER_SCRIPT = String.raw`window.Player = function (o) {
  const $ = (id) => document.getElementById(id);
  const root = $("stage"), cam = $("cam"), cap = $("cap"), bar = $("bar"), fi = $("fi"), kn = $("kn");
  const tm = $("tm"), sub = $("sub"), bPlay = $("play"), bListen = $("listen"), bCC = $("cc"), au = $("au");
  const steps = o.steps, N = steps.length, VB = o.vb || [960, 440];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const est = (s) => Math.max(4.2, s.say.split(/\s+/).filter(Boolean).length / 2.55 + 1.5);
  const T = window.TIMING && window.TIMING.starts ? window.TIMING : (() => {
    const a = []; let t = 0.6;
    steps.forEach((s) => { a.push(t); t += est(s); });
    return { starts: a, total: t + 1.6 };
  })();
  const hasAudio = !!(au && au.getAttribute("src"));
  let t = 0, playing = false, userPaused = false, mode = "silent", cur = -1, last = 0, raf = [], holdUntil = 0, cc = true;
  T.starts.forEach((s, k) => {
    if (k === 0) return;
    const i = document.createElement("i"); i.style.left = (s / T.total) * 100 + "%"; bar.appendChild(i);
  });
  if (!hasAudio) { bListen.style.display = "none"; bCC.style.display = "none"; }
  const fmt = (s) => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  function camTo(c) {
    if (!cam) return;
    const [s, cx, cy] = c || [1, VB[0] / 2, VB[1] / 2];
    let tx = VB[0] / 2 - s * cx, ty = VB[1] / 2 - s * cy;
    tx = Math.min(0, Math.max(VB[0] - s * VB[0], tx)); ty = Math.min(0, Math.max(VB[1] - s * VB[1], ty));
    cam.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + s + ")";
  }
  function fit(k, c) {
    if (!c || !cam) return c;
    let [s, cx, cy] = c;
    if (s <= 1.001) return c;
    const M = 14, sel = (j) => ".g" + j;
    const bb = (e) => { try { const b = e.getBBox(); return b.width || b.height ? { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height } : null; } catch (_) { return null; } };
    const uni = (a, b) => !a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
    let B = null;
    cam.querySelectorAll(sel(k)).forEach((e) => { B = uni(B, bb(e)); });
    const vis = [];
    cam.querySelectorAll(Array.from({ length: k + 1 }, (_, j) => sel(j)).join(",")).forEach((g) => {
      const L = g.tagName === "rect" || g.tagName === "text" ? [g] : [...g.querySelectorAll("rect,text")];
      L.forEach((e) => {
        if (getComputedStyle(e).opacity === "0") return;
        const b = bb(e);
        if (b && b.x1 - b.x0 < VB[0] * 0.6 && b.y1 - b.y0 < VB[1] * 0.6) vis.push(b);
      });
    });
    for (let it = 0; it < 40; it++) {
      if (B) s = Math.max(1, Math.min(s, VB[0] / (B.x1 - B.x0 + 2 * M), VB[1] / (B.y1 - B.y0 + 2 * M)));
      const hw = VB[0] / 2 / s, hh = VB[1] / 2 / s;
      if (B) { cx = Math.min(Math.max(cx, B.x1 + M - hw), B.x0 - M + hw); cy = Math.min(Math.max(cy, B.y1 + M - hh), B.y0 - M + hh); }
      cx = Math.min(Math.max(cx, hw), VB[0] - hw); cy = Math.min(Math.max(cy, hh), VB[1] - hh);
      const V = { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
      const part = vis.filter((b) => b.x1 > V.x0 && b.x0 < V.x1 && b.y1 > V.y0 && b.y0 < V.y1 &&
        !(b.x0 >= V.x0 - 1 && b.x1 <= V.x1 + 1 && b.y0 >= V.y0 - 1 && b.y1 <= V.y1 + 1));
      if (!part.length || s <= 1.001) break;
      part.forEach((b) => { B = uni(B, b); });
    }
    return s < 1.08 ? [1, VB[0] / 2, VB[1] / 2] : [s, cx, cy];
  }
  function apply(k) {
    raf.forEach(cancelAnimationFrame); raf = [];
    document.querySelectorAll(".tok").forEach((e) => { e.style.opacity = 0; });
    cur = k;
    const c = ["stage"];
    for (let j = 0; j <= k; j++) c.push("s" + j);
    c.push("at" + k);
    if (mode === "audio") c.push("audio");
    root.setAttribute("class", c.join(" "));
    cap.innerHTML = "<b>" + (k + 1) + ". " + steps[k].t + "</b><span>" + steps[k].c + "</span>";
    camTo(reduce ? null : fit(k, steps[k].cam));
    sub.textContent = steps[k].sub || "";
    sub.classList.toggle("on", mode === "audio" && cc && !!steps[k].sub);
    if (steps[k].on && !reduce) steps[k].on();
  }
  const idx = (x) => { let k = 0; for (let j = 0; j < N; j++) if (x >= T.starts[j]) k = j; return k; };
  function draw() { const p = (t / T.total) * 100; fi.style.width = p + "%"; kn.style.left = p + "%"; tm.textContent = fmt(t) + " / " + fmt(T.total); }
  function seek(x) { t = Math.max(0, Math.min(T.total - 0.05, x)); if (mode === "audio") au.currentTime = t; const k = idx(t); if (k !== cur) apply(k); draw(); }
  function setPlay(v) {
    playing = v; bPlay.textContent = v ? "❚❚" : "▶"; bPlay.title = v ? "Pause (Space)" : "Play (Space)";
    if (mode === "audio") { if (v) au.play().catch(() => {}); else au.pause(); }
  }
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!playing) return;
    if (mode === "audio") { t = au.currentTime; if (au.ended || t >= T.total - 0.02) stopAudio(true); }
    else { if (now < holdUntil) return; t += dt; if (t >= T.total) { holdUntil = now + 2600; t = 0; apply(0); } }
    const k = idx(t); if (k !== cur) apply(k); draw();
  }
  function startAudio() { mode = "audio"; bListen.classList.add("on"); bListen.textContent = "🔊 Narration on"; userPaused = false; au.currentTime = 0; t = 0; apply(0); setPlay(true); }
  function stopAudio(ended) {
    au.pause(); mode = "silent"; bListen.classList.remove("on"); bListen.textContent = "🔊 Listen with sound";
    sub.classList.remove("on"); root.classList.remove("audio");
    if (ended) { setPlay(false); userPaused = true; }
  }
  bListen.onclick = () => (mode === "audio" ? stopAudio(false) : startAudio());
  bPlay.onclick = () => { userPaused = playing; setPlay(!playing); };
  bCC.onclick = () => { cc = !cc; bCC.classList.toggle("on", cc); sub.classList.toggle("on", mode === "audio" && cc && !!steps[cur].sub); };
  $("prev").onclick = () => seek(T.starts[Math.max(0, cur - (t - T.starts[cur] > 1.2 ? 0 : 1))] + 0.01);
  $("next").onclick = () => seek(T.starts[Math.min(N - 1, cur + 1)] + 0.01);
  bar.onclick = (e) => { const r = bar.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * T.total); };
  document.addEventListener("keydown", (e) => {
    if (e.key === " ") { e.preventDefault(); bPlay.click(); }
    else if (e.key === "ArrowRight") $("next").click();
    else if (e.key === "ArrowLeft") $("prev").click();
    else if (e.key === "m" || e.key === "M") bListen.click();
    else if (e.key === "c" || e.key === "C") bCC.click();
  });
  window.flow = function (tok, path, ms, delay, loop) {
    const e = $(tok), p = $(path);
    if (!e || !p) return;
    const L = p.getTotalLength(), st = performance.now() + (delay || 0);
    const f = (now) => {
      const u = (now - st) / ms;
      if (u < 0) { raf.push(requestAnimationFrame(f)); return; }
      const v = loop ? u % 1 : Math.min(1, u);
      const q = p.getPointAtLength(L * (v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2));
      e.setAttribute("cx", q.x); e.setAttribute("cy", q.y);
      e.style.opacity = loop ? (v < 0.08 ? v / 0.08 : v > 0.92 ? (1 - v) / 0.08 : 1) : 1;
      if (loop || u < 1) raf.push(requestAnimationFrame(f));
    };
    raf.push(requestAnimationFrame(f));
  };
  if (reduce) { apply(N - 1); t = T.total; draw(); }
  else {
    apply(0); draw();
    new IntersectionObserver((es) => es.forEach((en) => {
      const visible = en.isIntersecting && en.intersectionRatio >= 0.35;
      if (visible && !userPaused && !playing) setPlay(true);
      if (!visible && playing) setPlay(false);
    }), { threshold: [0, 0.35, 0.6] }).observe(root);
  }
  requestAnimationFrame((n) => { last = n; frame(n); });
  const wrap = document.querySelector(".wrap");
  const postH = () => { try { parent.postMessage({ snagenticAnimH: Math.ceil(wrap.getBoundingClientRect().height) + 6 }, "*"); } catch (_) {} };
  addEventListener("load", postH); addEventListener("resize", postH); new ResizeObserver(postH).observe(wrap);
  // For recording (video export): jump to a time without the clock running.
  window.snagenticPlayer = { total: T.total, starts: T.starts, seek: (x) => { setPlay(false); userPaused = true; seek(x); } };
};
`;
