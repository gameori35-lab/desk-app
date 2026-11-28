/* Hand-drawn canvas charts, DPR aware. No libraries. */
(() => {
"use strict";
const RM = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const C = {green: "#00d35a", red: "#ff453a", orange: "#ff9f0a", cyan: "#64d2ff", blue: "#0a84ff", grey: "#2c2c2e",
  t2: "rgba(235,235,245,0.6)", t3: "rgba(235,235,245,0.3)", sep: "rgba(84,84,88,0.55)"};
const memo = {};
function setup(cv) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); return [g, w, h];
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function anim(ms, f) {
  if (RM()) { f(1); return; }
  const t0 = performance.now();
  const step = t => { const p = Math.min(1, (t - t0) / ms); f(p); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
const easeOut = p => 1 - Math.pow(1 - p, 3);

/* Balance line: #00d35a, gradient fill under the line, dashed start line, marks above line that never overlap. */
function line(cv, key, pts, marks, start) {
  const prev = memo[key];
  const lastT = pts.length ? pts[pts.length - 1][0] : 0;
  const seen = new Set(prev ? prev.marks : []);
  const mk = m => m.ts + "|" + m.text;
  memo[key] = {lastT, marks: marks.map(mk)};
  const slide = prev && prev.lastT && lastT > prev.lastT && pts.length > 2;
  const fresh = marks.filter(m => !seen.has(mk(m)));
  let pSlide = slide ? 0 : 1, pFade = prev ? 0 : 1;
  const draw = () => {
    const [g, w, h] = setup(cv);
    const top = 64, bot = h - 14;
    if (!pts.length) {
      const y = (top + bot) / 2;
      g.strokeStyle = C.t3; g.setLineDash([4, 5]); g.lineWidth = 1; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); return;
    }
    let vals = pts.map(p => p[1]); if (start != null) vals.push(start);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; } const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const t0 = pts[0][0], t1 = Math.max(pts[pts.length - 1][0], t0 + 1);
    const X = t => 8 + (w - 16) * (t - t0) / (t1 - t0), Y = v => bot - (bot - top) * (v - lo) / (hi - lo);
    let P = pts.map(p => [X(p[0]), Y(p[1])]);
    if (pSlide < 1 && P.length > 1) { const a = P[P.length - 2], b = P[P.length - 1], e = easeOut(pSlide); P[P.length - 1] = [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e]; }
    if (start != null) { const ys = Y(start); g.strokeStyle = C.t3; g.setLineDash([4, 5]); g.lineWidth = 1; g.beginPath(); g.moveTo(0, ys); g.lineTo(w, ys); g.stroke(); g.setLineDash([]); }
    const grd = g.createLinearGradient(0, top, 0, bot); grd.addColorStop(0, "rgba(0,211,90,0.28)"); grd.addColorStop(1, "rgba(0,211,90,0)");
    g.beginPath(); g.moveTo(P[0][0], bot); P.forEach(p => g.lineTo(p[0], p[1])); g.lineTo(P[P.length - 1][0], bot); g.closePath(); g.fillStyle = grd; g.fill();
    g.beginPath(); P.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.strokeStyle = C.green; g.lineWidth = 2.2; g.lineJoin = "round"; g.stroke();
    const L = P[P.length - 1]; g.fillStyle = C.green; g.beginPath(); g.arc(L[0], L[1], 4, 0, 7); g.fill();
    // marks: above the line; a later mark that would overlap moves up a row
    g.font = "600 12px -apple-system, 'SF Pro Text', sans-serif"; g.textBaseline = "middle";
    const placed = [];
    const valAt = t => { let best = pts[0]; for (const p of pts) { if (p[0] <= t) best = p; else break; } return best[1]; };
    for (const m of marks) {
      if (m.ts < t0) continue;
      const x = X(Math.min(m.ts, t1)), yLine = Y(valAt(m.ts)), tw = g.measureText(m.text).width + 14;
      let bx = Math.max(2, Math.min(w - tw - 2, x - tw / 2)), row = 0, by;
      for (;;) { by = Math.max(2, yLine - 34 - row * 26); if (!placed.some(q => Math.abs(q.by - by) < 24 && bx < q.bx + q.w + 4 && q.bx < bx + tw + 4)) break; row++; if (row > 8) break; }
      placed.push({bx, by, w: tw});
      const col = C[m.tone] || C.t2;
      g.globalAlpha = fresh.includes(m) ? pFade : 1;
      g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(x, by + 22); g.lineTo(x, yLine - 4); g.stroke();
      g.fillStyle = col; g.beginPath(); g.arc(x, yLine, 3, 0, 7); g.fill();
      rr(g, bx, by, tw, 22, 11); g.fillStyle = "#1c1c1e"; g.fill();
      g.fillStyle = col; g.fillText(m.text, bx + 7, by + 11.5); g.globalAlpha = 1;
    }
  };
  draw();
  if (slide) anim(250, p => { pSlide = p; draw(); });
  if (fresh.length && prev) anim(200, p => { pFade = p; draw(); });
}

/* 1-min OHLC candles with volume bars and an orange dashed "Risk trailing stop" line. */
function candles(cv, cs, riskLine, entry) {
  const [g, w, h] = setup(cv);
  const vh = 36, top = 10, bot = h - vh - 10;
  if (!cs || !cs.length) { g.fillStyle = C.t2; g.font = "14px -apple-system, sans-serif"; g.textAlign = "center"; g.fillText("No price reads yet", w / 2, h / 2); return; }
  const lo0 = Math.min(...cs.map(c => c[3]), riskLine ?? Infinity, entry ?? Infinity), hi0 = Math.max(...cs.map(c => c[2]), riskLine ?? -Infinity, entry ?? -Infinity);
  const pad = (hi0 - lo0 || hi0 * 0.02 || 1) * 0.08, lo = lo0 - pad, hi = hi0 + pad;
  const Y = v => bot - (bot - top) * (v - lo) / (hi - lo);
  const n = Math.max(cs.length, 30), cw = (w - 8) / n, vmax = Math.max(...cs.map(c => c[5]), 1e-9);
  cs.forEach((c, i) => {
    const x = 4 + (n - cs.length + i) * cw + cw / 2, upc = c[4] >= c[1], col = upc ? C.green : C.red;
    g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(x, Y(c[2])); g.lineTo(x, Y(c[3])); g.stroke();
    const y1 = Y(Math.max(c[1], c[4])), y2 = Y(Math.min(c[1], c[4]));
    g.fillStyle = col; g.fillRect(x - Math.max(1, cw * 0.35), y1, Math.max(2, cw * 0.7), Math.max(1, y2 - y1));
    const vb = (vh - 4) * c[5] / vmax; g.globalAlpha = 0.5; g.fillRect(x - Math.max(1, cw * 0.35), h - 4 - vb, Math.max(2, cw * 0.7), vb); g.globalAlpha = 1;
  });
  g.font = "600 11px -apple-system, sans-serif"; g.textBaseline = "bottom";
  if (entry != null) { const y = Y(entry); g.strokeStyle = C.t3; g.setLineDash([2, 4]); g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); g.setLineDash([]); }
  if (riskLine != null) { const y = Y(riskLine); g.strokeStyle = C.orange; g.setLineDash([6, 5]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); g.setLineDash([]); g.fillStyle = C.orange; g.fillText("Risk trailing stop", 6, y - 3); }
}

/* Analyst score ring 0-100, green from min score. */
function ring(cv, score, min) {
  const [g, w, h] = setup(cv); const r = Math.min(w, h) / 2 - 6, cx = w / 2, cy = h / 2;
  g.lineWidth = 9; g.lineCap = "round"; g.strokeStyle = C.grey; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
  if (score == null) return;
  g.strokeStyle = score >= min ? C.green : C.red; g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * Math.max(0.005, score / 100)); g.stroke();
  g.fillStyle = "#fff"; g.font = "700 30px 'SF Pro Display', -apple-system, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(score), cx, cy + 1);
}

/* Auditor: the coin as a stack of 8 discs. state[i] = "g" | "r" | "b" (beam) | null; layer 1 on top. */
function discs(cv, state) {
  const [g, w, h] = setup(cv); const rx = Math.min(w * 0.36, 120), ry = 13, gap = 15, cx = w / 2, y0 = 26;
  for (let i = 7; i >= 0; i--) {
    const y = y0 + i * gap, s = state[i];
    const col = s === "g" ? C.green : s === "r" ? C.red : s === "b" ? C.cyan : "#2c2c2e";
    g.fillStyle = s ? col : "#2c2c2e"; g.globalAlpha = s ? 0.9 : 1;
    g.beginPath(); g.ellipse(cx, y + 6, rx, ry, 0, 0, 7); g.fill();
    g.globalAlpha = 1; g.fillStyle = s ? col : "#3a3a3c"; g.beginPath(); g.ellipse(cx, y, rx, ry, 0, 0, 7); g.fill();
    g.strokeStyle = "#000"; g.lineWidth = 1.5; g.stroke();
  }
}
window.DeskChart = {line, candles, ring, discs, anim, RM};
})();
