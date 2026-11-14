/* Desk app. Plain JS, no frameworks, no build step. Charts on canvas (chart.js).
   Data: AES-256-GCM encrypted JSON under d/{DATA_PATH}/; path + key come from the one-time link fragment
   #d={DATA_PATH}.{DATA_KEY}, are kept in localStorage and removed from the URL. Plan B: all controls read-only. */
(() => {
"use strict";
const POLL_MS = 15000, RETRY_S = 15, STALE_S = 900, LS = "desk.k1", SEEN = "desk.seen";
const K = window.DeskChart, RM = K.RM;
const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = $("#view"), errEl = $("#err");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[c]));
const money = (v, d = 2) => v == null || isNaN(v) ? "n/a" : (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", {minimumFractionDigits: d, maximumFractionDigits: d});
const smoney = v => v == null ? "n/a" : (v >= 0 ? "+" : "-") + "$" + Math.abs(v).toFixed(2);
const pct = (v, d = 2) => v == null || isNaN(v) ? "n/a" : (v >= 0 ? "+" : "") + v.toFixed(d) + "%";
const px = v => v == null ? "n/a" : "$" + (v >= 1 ? v.toFixed(4) : v.toPrecision(4));
const kfmt = v => v == null ? "n/a" : v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(1) + "K" : "$" + v.toFixed(0);
const hhmm = t => t ? new Date(typeof t === "number" ? t : Date.parse(t)).toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit", timeZone: "Europe/London"}) : "";
const chev = `<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>`;
const CK = `<svg viewBox="0 0 12 12"><path d="M2.5 6.5l2.5 2.5 4.5-5"/></svg>`, CX = `<svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6"/></svg>`;
const SHIELD = `<svg viewBox="0 0 16 16"><path d="M8 1l6 2.5v4C14 11 11.5 14 8 15 4.5 14 2 11 2 7.5v-4z"/></svg>`;
const AG = {scanner: ["Scanner", "#64d2ff"], auditor: ["Auditor", "#fff"], analyst: ["Analyst", "#ffd60a"], executor: ["Executor", "#00d35a"], risk: ["Risk", "#ff6b9a"]};
const ORDER = ["scanner", "auditor", "analyst", "executor", "risk"];

/* ---------- key + crypto */
function takeKey() {
  const m = location.hash.match(/[#&]d=([A-Za-z0-9]+)\.([A-Za-z0-9_-]+)/);
  if (m) { localStorage.setItem(LS, JSON.stringify({p: m[1], k: m[2]})); history.replaceState(null, "", location.pathname + location.search); }
  try { return JSON.parse(localStorage.getItem(LS) || "null"); } catch { return null; }
}
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64u = s => b64(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
let creds = null, ckey = null;
async function load(rel) {
  const r = await fetch(`d/${creds.p}/${rel}?t=${Date.now()}`, {cache: "no-store"});
  if (r.status === 404) { const e = new Error("404"); e.kind = 404; throw e; }
  if (!r.ok) throw new Error("HTTP " + r.status);
  const env = await r.json();
  ckey = ckey || await crypto.subtle.importKey("raw", b64u(creds.k), "AES-GCM", false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({name: "AES-GCM", iv: b64(env.iv), additionalData: new TextEncoder().encode("desk-v1")}, ckey, b64(env.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ---------- state */
const S = {tab: "home", screen: null, id: null, range: "LIVE", st: null, chart: null, act: null, acct: null, sets: null, agents: {}, coin: {}, audit: {},
  err: null, lastOk: 0, nextTry: 0, more: [], beam: {}, loaded: false};
let inflight = false;
async function refresh() {
  if (inflight) return; inflight = true;
  try {
    const [st, ch, ac] = await Promise.all([load("state.json"), load("chart.json"), load("activity.json")]);
    Object.assign(S, {st, chart: ch, act: ac, err: null, lastOk: Date.now()});
    if (S.tab === "account" || !S.acct) [S.acct, S.sets] = await Promise.all([load("account.json"), load("settings.json")]);
    if (S.tab === "agents") await Promise.all(ORDER.map(async a => { try { S.agents[a] = await load(`agents/${a}.json`); } catch {} }));
    if (S.screen) await loadScreen();
  } catch (e) { S.err = e; }
  inflight = false; S.loaded = true; S.nextTry = Date.now() + (S.err ? RETRY_S : POLL_MS / 1000) * 1000;
  render();
}
async function loadScreen() {
  const kind = S.screen, id = S.id;
  try { S[kind][id] = await load(`${kind}/${id}.json`); } catch (e) { if (e.kind === 404) S[kind][id] = {_gone: true}; else throw e; }
}
function errRow() {
  const stale = S.st && (Date.now() - Date.parse(S.st.ts)) / 1000 > STALE_S;
  if (!S.err && !stale) { errEl.hidden = true; return; }
  const n = Math.max(0, Math.ceil((S.nextTry - Date.now()) / 1000));
  errEl.hidden = false;
  errEl.textContent = `Desk offline · retrying in ${n}s · last update ${S.st ? hhmm(S.st.ts) : "never"}`;
}
setInterval(errRow, 1000);

/* ---------- navigation */
function go(tab) { S.tab = tab; S.screen = null; $$("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab)); scrollTo(0, 0); render(); refresh(); }
async function open(kind, id) { if (!id) return; S.screen = kind; S.id = id; scrollTo(0, 0); render(); try { await loadScreen(); } catch (e) { S.err = e; } render(); }
$$("#tabs button").forEach(b => b.onclick = () => go(b.dataset.tab));
document.addEventListener("click", e => {
  const t = e.target.closest("[data-go],[data-open],[data-range],[data-act]"); if (!t) return;
  if (t.dataset.go) go(t.dataset.go);
  else if (t.dataset.open) open(...t.dataset.open.split(":"));
  else if (t.dataset.range) { S.range = t.dataset.range; render(); }
  else act(t.dataset.act, t);
});
async function act(a, t) {
  if (a === "back") { S.screen = null; render(); }
  else if (a === "search") search();
  else if (a === "invite") {
    const url = S.acct && S.acct.SIGNUP_URL; if (!url) return;
    if (navigator.share) { try { await navigator.share({url}); return; } catch (e) { if (e.name === "AbortError") return; } }
    try { await navigator.clipboard.writeText(url); } catch { const i = document.createElement("textarea"); i.value = url; document.body.append(i); i.select(); document.execCommand("copy"); i.remove(); }
    toast("Link copied");
  } else if (a === "more") {
    const pg = (S.more.length ? S.more[S.more.length - 1].page : 1) + 1;
    try { S.more.push(await load(`activity/${pg}.json`)); } catch {} render();
  } else if (a === "testpush") toast("Send test to the desk bot in Telegram");
  else if (a === "settings") { go("account"); setTimeout(() => { const el = $("#settings"); el && el.scrollIntoView(); }, 50); }
}
function toast(msg) { const d = document.createElement("div"); d.className = "toast fade"; d.textContent = msg; document.body.append(d); setTimeout(() => d.remove(), 1800); }
function search() {
  const ov = document.createElement("div"); ov.className = "search";
  ov.innerHTML = `<div class="f"><input placeholder="Name, symbol or mint" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="cx">Cancel</button></div><div class="rows" style="margin-top:12px"></div>`;
  document.body.append(ov);
  const inp = $("input", ov), list = $(".rows", ov);
  const draw = () => {
    const q = inp.value.trim().toLowerCase(), cs = (S.st && S.st.coins) || [];
    const hits = q ? cs.filter(c => [c.name, c.symbol, c.mint].some(x => x && x.toLowerCase().includes(q))) : cs.slice(0, 12);
    list.innerHTML = hits.length ? hits.slice(0, 30).map(c => `<button class="row" data-id="${c.id}"><div class="l"><div class="t1">${esc(c.name || c.mint.slice(0, 6))}</div><div class="t2">${esc(c.symbol || "")} · ${esc(c.mint.slice(0, 4))}…${esc(c.mint.slice(-4))}</div></div><div class="rt t2">${esc(c.status || "")}</div></button>`).join("")
      : `<div class="emptyrow">No coin on the desk matches</div>`;
  };
  inp.oninput = draw; draw(); setTimeout(() => inp.focus(), 30);
  $(".cx", ov).onclick = () => ov.remove();
  list.onclick = e => { const r = e.target.closest("[data-id]"); if (r) { ov.remove(); open("coin", r.dataset.id); } };
}

/* ---------- pieces */
function odometer(el, v) {
  const txt = v == null ? "$–" : money(v);
  if (el.dataset.v === txt) return;
  const instant = RM() || !el.dataset.v || el.dataset.v.length !== txt.length;
  el.dataset.v = txt;
  if (instant || !el.children.length) {
    el.innerHTML = [...txt].map(ch => /\d/.test(ch) ? `<span class="d"><span class="s">${[..."0123456789"].map(n => `<span>${n}</span>`).join("")}</span></span>` : `<span class="c">${esc(ch)}</span>`).join("");
  }
  const digs = [...txt].map((ch, i) => [ch, el.children[i]]).filter(([ch]) => /\d/.test(ch));
  digs.forEach(([ch, node], i) => {
    const s = node.firstChild; const h = s.firstChild.getBoundingClientRect().height || 70;
    s.style.transitionDelay = instant ? "0ms" : `${(digs.length - 1 - i) * 30}ms`;   // right-to-left stagger
    if (instant) s.style.transition = "none";
    s.style.transform = `translateY(-${+ch * h}px)`;
    if (instant) requestAnimationFrame(() => { s.style.transition = ""; });
  });
}
const odo = document.createElement("div"); odo.className = "big";
const paperPill = () => S.st && S.st.mode === "PAPER" ? `<span class="pill paper">PAPER</span>` : "";
const cardW = () => Math.min(innerWidth, 600) - 32;
function actRow(a) {
  const open = a.coin ? (a.kind === "rejected" ? `audit:${a.coin}` : `coin:${a.coin}`) : "";
  const ic = {bought: "B", sold: "S", stopped: "!", rejected: "×"}[a.kind] || "·";
  const tone = a.kind === "sold" ? (String(a.value).startsWith("-") ? "dn" : "up") : a.kind === "stopped" ? "dn" : a.kind === "rejected" ? "mut" : "";
  return `<button class="row" ${open ? `data-open="${open}"` : ""}><div class="ico ${a.kind}">${ic}</div><div class="l"><div class="t1">${esc(a.title)}</div><div class="t2">${esc(a.subtitle)}</div></div><div class="rt ${tone}">${esc(a.value)}</div></button>`;
}
function rowsOrEmpty(rows, empty) { return `<div class="rows">${rows.length ? rows.map(actRow).join("") : `<div class="emptyrow">${empty}</div>`}</div>`; }
function layerClasses(layers, running, current) {
  const out = []; for (let i = 0; i < 8; i++) { const l = layers && layers[i]; out.push(l && l.pass === true ? "g" : l && l.pass === false ? "r" : running && current === i + 1 ? "b" : ""); } return out;
}
function agentCard(a, full) {
  const c = S.st.agents[a], [nm, col] = AG[a], st = S.st;
  let ct = "", sub = "", body = "";
  if (a === "scanner") {
    ct = `${c.count} pools`; sub = `${c.waiting} in the waiting room`;
    body = c.feed.length ? `<div class="feed">${c.feed.slice(0, full ? 6 : 4).map(f => `<div class="r ${f.tone === "kill" ? "k" : "p"}"><span class="n">${esc(f.text)}</span><span class="w">${f.tone === "kill" ? esc(f.reason) : "→ auditor"}</span></div>`).join("")}</div>`
      : `<div class="mut">Listening for graduations</div>`;
  } else if (a === "auditor") {
    ct = `${c.count} taken apart`; sub = `${c.rejected} rejected`;
    const run = c.running, last = c.last;
    if (!run && !last) body = `<div class="strips">${"<i></i>".repeat(8)}</div><div class="mut">No coin taken apart yet</div>`;
    else {
      const ls = run ? layerClasses(run.layers.map(l => ({pass: l.pass})), true, run.current) : layerClasses(last.layers);
      const line = run ? `${esc(run.name)} · taking apart...` : last.passed ? `${esc(last.name)} · 8/8 → Executor` : `${esc(last.name)} · ${esc(last.reason)}`;
      body = `<div class="strips">${ls.map(x => `<i class="${x}"></i>`).join("")}</div><div class="${run ? "" : last.passed ? "up" : "dn"}" style="font-size:14px;font-weight:500">${line}</div>`;
    }
  } else if (a === "analyst") {
    ct = "Scoring"; sub = `${c.count} scored${c.mode === "rules" ? " · rules" : ""}`;
    body = `<div style="display:flex;align-items:center;gap:14px"><canvas class="ring" data-score="${c.last ? c.last.score : ""}" data-min="${c.minScore}" style="width:84px;height:84px"></canvas><div style="min-width:0"><div class="t1" style="font-weight:600">${c.last ? esc(c.last.name) : "Nothing scored yet"}</div><div class="mut" style="font-size:13px">${c.last ? (c.last.pass ? "Pass · min " + c.minScore : esc(c.last.reason)) : "Green from " + c.minScore}</div></div></div>`;
  } else if (a === "executor") {
    ct = `${c.count} trades`; sub = `${c.stackPct}% of stack per trade`;
    if (c.live) { const p = Math.min(99, Math.round(100 * c.live.elapsed / 5)); body = `<div>${esc(c.live.name || "")}</div><div class="bar"><b style="width:${p}%"></b></div><div class="mut">Executing... ${p}%</div>`; }
    else if (c.last) body = `<div style="font-weight:600">${esc(c.last.name)}</div><div class="mut">${c.last.size ? money(c.last.size) + " · " + c.last.stackPct + "% of stack" : esc(c.last.reason || "")}</div>` + (c.last.status === "bought" ? `<div class="bar"><b style="width:100%"></b></div><div class="up">✓ Filled</div>` : `<div class="mut">${esc(c.last.status)}</div>`);
    else body = `<div class="mut">No trade yet tonight</div>`;
  } else {
    const le = c.lastExit;
    ct = c.guarding ? "Guarding" : le ? (le.reason === "trail" ? "Trailed out" : le.reason === "stop" ? "Stopped" : "Guarding") : "Guarding";
    sub = c.guarding ? `${c.count} open position${c.count > 1 ? "s" : ""}` : le ? `${esc(le.name)} · ${smoney(le.pnl)}` : "Nothing open";
    body = `<div class="pills"><span class="pill red">stop -${c.stopPct}%</span><span class="pill green">trail ${c.trailPct}%</span></div>`;
  }
  const w = cardW(), h = w * 470 / 504, r = 42 * w / 504;
  return `<div class="card" style="width:${w}px;height:${h}px;border-radius:${r}px"><div class="hd"><div class="nm" style="color:${col}">${nm}</div>${c.paused ? `<span class="pill grey">paused</span>` : ""}</div><div class="ct">${ct}</div><div class="sub">${sub}</div><div class="body">${body}</div></div>`;
}
function skHome() { return `<div class="nav"><div class="sk" style="width:32px;height:32px;border-radius:16px"></div><div class="sk" style="width:110px;height:20px"></div></div><div class="sk" style="width:240px;height:66px;margin-top:6px"></div><div class="sk" style="width:150px;height:22px;margin-top:10px"></div><div class="sk" style="height:230px;margin-top:12px"></div><div class="sk" style="height:36px;margin-top:8px"></div><div class="sk" style="width:${cardW()}px;height:${cardW() * 470 / 504}px;border-radius:${42 * cardW() / 504}px;margin-top:24px"></div>`; }
function skList(n = 6) { return `<div class="sk" style="width:160px;height:30px;margin:16px 0"></div>` + `<div class="sk" style="height:60px;margin-bottom:2px;border-radius:4px"></div>`.repeat(n); }

/* ---------- screens */
function home() {
  const st = S.st, ch = S.chart.ranges[S.range] || {points: [], marks: []};
  const unread = (st.lastActivityId || 0) > +(localStorage.getItem(SEEN) || 0);
  const handle = (S.acct && S.acct.fomo_handle) || "";
  const tp = st.todayPct || 0, trades = (S.chart.ranges.ALL.marks || []).length;
  const html = `<div class="nav"><button data-go="account" class="ib" style="width:44px"><span class="avatar">${esc((handle.replace("@", "")[0] || "G").toUpperCase())}</span></button>
    <button class="title" data-go="agents">Grok Bot <span>›</span></button>
    <button class="ib" data-act="search" aria-label="Search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg></button>
    <button class="ib" data-go="activity" aria-label="Activity"><svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/></svg>${unread ? `<i class="dot"></i>` : ""}</button></div>
    <div class="balrow"><div id="odo"></div>${paperPill()}</div>
    <div class="today"><span class="${tp >= 0 ? "up" : "dn"}">${pct(tp)}</span><span class="mut" style="font-weight:500">today</span><span class="pill green">${(st.multiplier || 1).toFixed(2)}×</span></div>
    <div class="chartwrap"><canvas id="bal"></canvas>${trades ? "" : `<div class="empty">Waiting for the first trade</div>`}</div>
    <div class="ranges">${["LIVE", "1H", "4H", "1D", "1W", "ALL"].map(r => `<button data-range="${r}" class="${r === S.range ? "on" : ""}">${r}</button>`).join("")}</div>
    <div class="sec"><h2>Agents <span class="mut">· ${st.running} running</span></h2></div>
    <div class="car">${ORDER.map(a => agentCard(a)).join("")}</div>
    <div class="sec"><h2>Activity</h2><button data-go="activity">See all</button></div>
    ${rowsOrEmpty(S.act.rows.slice(0, 5), "Nothing yet tonight")}<div style="height:20px"></div>`;
  view.innerHTML = html; $("#odo").replaceWith(odo); odometer(odo, st.balance);
  // empty state: dashed start line only, until the first trade
  K.line($("#bal"), "bal:" + S.range, trades ? ch.points : [], trades ? ch.marks : [], S.chart.start);
}
function agentsTab() {
  const st = S.st;
  view.innerHTML = `<div class="nav"><div class="title" style="font:700 34px var(--disp)">Agents</div>${paperPill()}</div>
  <div class="note">Read-only on this hosting: pause and resume from Telegram (pause scanner · resume scanner).</div>` + ORDER.map(a => {
    const c = st.agents[a], [nm, col] = AG[a], hb = c.heartbeat, down = !hb || (Date.now() - Date.parse(hb.ts)) / 1000 > 300;
    const decs = (S.agents[a] && S.agents[a].decisions) || null;
    const lock = a === "risk" && c.lockedOpen;
    return `<div class="agentfull"><div class="hd"><span class="sdot ${down ? "down" : c.paused ? "paused" : ""}"></span><div class="nm" style="color:${col}">${nm}</div><span class="mut">${c.count} today</span><span class="sw ${c.paused ? "" : "on"}" role="switch" aria-checked="${!c.paused}" aria-disabled="true" title="${lock ? "Locked while a position is open" : "Read-only on this hosting"}"></span></div>
      ${lock ? `<div class="note">Can't pause Risk while a position is open</div>` : ""}
      ${decs == null ? `<div class="sk" style="height:120px;margin-top:6px"></div>` : decs.length ? decs.map(d => `<div class="dec"><span class="tm">${hhmm(d.ts)}</span><span class="cn">${d.coin_url ? `<a href="${esc(d.coin_url)}" target="_blank" rel="noopener">${esc(d.name)}</a>` : esc(d.name)}</span><span class="vd ${/pass|ok|bought|trail|sold/.test(d.verdict) ? "up" : /kill|reject|stop|skip/.test(d.verdict) ? "dn" : "mut"}">${esc(d.verdict)}</span><span class="rs">${esc(d.reason)}</span></div>`).join("")
        : `<div class="note">${a === "scanner" ? "Listening for graduations" : a === "auditor" ? "No coin taken apart yet" : "Nothing yet tonight"}</div>`}
      <button class="lnk" data-act="settings">Settings</button></div>`;
  }).join("");
}
function activityTab() {
  const rows = S.act.rows.concat(...S.more.map(p => p.rows));
  const more = S.act.pages > 1 + S.more.length;
  view.innerHTML = `<div class="nav"><div class="title" style="font:700 34px var(--disp)">Activity</div>${paperPill()}</div>${rowsOrEmpty(rows, "Nothing yet tonight")}${more ? `<button class="btn dark" data-act="more">Show more</button>` : ""}<div style="height:20px"></div>`;
  localStorage.setItem(SEEN, String(S.st.lastActivityId || 0));
}
function accountTab() {
  const a = S.acct, s = S.sets;
  if (!a) { view.innerHTML = skList(); return; }
  const groups = {}; for (const [k, v] of Object.entries(s.values)) (groups[k.split(".")[0]] ||= []).push([k, v]);
  const label = k => k.split(".").slice(1).join(" ").replace(/_/g, " ").replace(/\busd\b/, "$").replace(/\bpct\b/, "%");
  const setRow = ([k, v]) => { const r = s.ranges[k]; const num = typeof v === "number" && Array.isArray(r) && typeof r[0] === "number";
    const shown = k === "risk.stop_pct" ? `-${v}%` : typeof v === "boolean" ? (v ? "on" : "off") : String(v);
    return `<div class="set"><div class="top"><span>${esc(label(k))}</span><span class="v">${esc(shown)}</span></div>${num ? `<input type="range" min="${r[0]}" max="${r[1]}" step="any" value="${v}" disabled aria-label="${esc(k)}">` : ""}</div>`; };
  view.innerHTML = `<div class="nav"><div class="title" style="font:700 34px var(--disp)">Account</div></div>
  <div class="rows"><div class="kv"><span class="k">Mode</span><span class="v">${a.mode === "PAPER" ? `<span class="pill paper">PAPER</span>` : "LIVE"}</span></div>
  <div class="kv"><span class="k">Stack</span><span class="v">${money(a.stack)}</span></div></div>
  <div class="note">Mode and stack are read-only here: send paper, live or stack 1240 to the desk bot in Telegram.</div>
  <div class="rows" style="margin-top:12px">
   <a class="row" href="${esc(a.profile_url)}" target="_blank" rel="noopener"><div class="l"><div class="t1">Your FOMO profile</div><div class="t2">${esc(a.fomo_handle || "")}</div></div><span class="chev">›</span></a>
   <button class="row" data-act="invite"><div class="l"><div class="t1">Invite a friend</div><div class="t2">Share your FOMO invite link</div></div><span class="chev">›</span></button></div>
  <div class="setgroup"><h3>Notifications</h3><div class="rows">
   <div class="kv"><span class="k">Telegram</span><span class="v ${a.telegram.connected ? "up" : "dn"}">${a.telegram.connected ? "Connected" : "Not connected"}</span></div>
   <button class="kv" data-act="testpush" style="width:100%"><span>Send test push</span><span class="v mut">Send test in Telegram</span></button>
   <div class="kv"><span class="k">Web push</span><span class="v mut" style="font-weight:400">${esc(a.webpush.text)}</span></div></div></div>
  <div id="settings">${["scanner", "auditor", "analyst", "executor", "risk", "desk"].filter(g => groups[g]).map(g => `<div class="setgroup"><h3>${AG[g] ? AG[g][0] : "Desk"}</h3><div class="rows">${groups[g].map(setRow).join("")}</div></div>`).join("")}</div>
  <div class="note">Settings are read-only on this hosting. Change one from Telegram, e.g. set stop to -8%.</div><div style="height:20px"></div>`;
}
function coinScreen() {
  const c = S.coin[S.id];
  const top = `<div class="nav"><button class="back" data-act="back">${chev}Back</button><div style="flex:1"></div>${paperPill()}</div>`;
  if (!c) { view.innerHTML = top + `<div class="sk" style="height:40px;width:200px"></div><div class="sk" style="height:44px;width:160px;margin-top:12px"></div><div class="sk" style="height:220px;margin-top:16px"></div><div class="sk" style="height:120px;margin-top:16px"></div>`; return; }
  if (c._gone) { view.innerHTML = top + `<div class="emptyrow">This coin isn't on the desk anymore</div>`; return; }
  const p = c.position, open = p && (p.status === "open" || p.status === "exiting"), x = c.exit;
  const since = p && c.price ? 100 * (c.price / p.entry - 1) : null;
  const age = c.ageH == null ? "" : c.ageH < 1 ? Math.round(c.ageH * 60) + "m old" : Math.round(c.ageH) + "h old";
  const left = x ? Math.max(0, x.timeoutAt - Date.now() / 1000) : 0;
  view.innerHTML = top + `<div class="headline" style="margin-top:0">${esc(c.name || c.mint.slice(0, 6))}</div>
   <div style="display:flex;align-items:center;gap:8px;margin-top:4px"><span class="mut">${esc(c.symbol || "")} · Solana${age ? " · " + age : ""}</span>${c.shield ? `<span class="chip ${c.auditPassed ? "g" : "r"}">${SHIELD}${c.shield}</span>` : ""}</div>
   <div class="mid" style="margin-top:14px">${px(c.price)}</div>
   ${since != null ? `<div class="${since >= 0 ? "up" : "dn"}" style="font-weight:600;margin-top:2px">${since >= 0 ? "▲" : "▼"} ${Math.abs(since).toFixed(2)}% since entry</div>` : ""}
   <canvas id="cdl" class="cv" style="height:240px;margin-top:12px"></canvas>
   <div class="stats"><div><div class="k">Market cap</div><div class="v">${kfmt(c.stats.marketCap)}</div></div><div><div class="k">Liquidity</div><div class="v">${kfmt(c.stats.liquidity)}</div></div>
    <div><div class="k">24h volume</div><div class="v">${kfmt(c.stats.volume24h)}</div></div><div><div class="k">Holders</div><div class="v">${c.stats.holders ? c.stats.holders.toLocaleString("en-US") : "n/a"}</div></div></div>
   ${p ? `<div class="rows"><div class="kv"><span>Your position · ${money(p.size)} in · Executor</span><span class="v ${(p.pnl ?? 0) >= 0 ? "up" : "dn"}">${open ? "" : smoney(p.pnl)}</span></div></div>` : ""}
   ${open && x ? `<div class="exit" style="margin-top:12px"><div class="kv"><span class="k">Stop line · -${x.stopPct}%</span><span class="v dn">${px(x.stopLine)}</span></div>
     <div class="kv"><span class="k">Trail line</span><span class="v">${x.trailLine ? px(x.trailLine) : "from " + px(x.trailStartsAt)}</span></div>
     <div class="kv"><span class="k">Time left to timeout</span><span class="v">${Math.floor(left / 3600)}h ${String(Math.floor(left % 3600 / 60)).padStart(2, "0")}m</span></div></div>` : ""}
   <a class="btn" href="${esc(c.coin_url)}" target="_blank" rel="noopener">${open ? "Sell on FOMO" : "Buy on FOMO"}</a>`;
  K.candles($("#cdl"), c.candles, open && x ? x.riskLine : null, p ? p.entry : null);
}
function auditScreen() {
  const d = S.audit[S.id];
  const top = `<div class="nav"><button class="back" data-act="back">${chev}Back</button><div style="flex:1"></div><span class="mut">Auditor</span></div>`;
  if (!d) { view.innerHTML = top + `<div class="sk" style="height:150px"></div>` + `<div class="sk" style="height:52px;margin-top:4px"></div>`.repeat(8); return; }
  if (d._gone) { view.innerHTML = top + `<div class="emptyrow">No coin taken apart yet</div>`; return; }
  const key = d.mint + d.ts, got = d.layers.filter(l => l.pass !== null).length;
  const b = S.beam[key] || (S.beam[key] = {shown: RM() ? got : 0, phase: 0, busy: false});
  const name = esc(d.name || d.mint.slice(0, 6)), done = !d.running && b.shown >= got;
  const head = !done ? `<div class="headline">Taking apart ${name}...</div><div class="mut">Layer ${Math.min(8, b.shown + 1)} of 8</div>`
    : d.passed ? `<div class="headline up">Cleared · 8/8 parts</div><div class="mut">${d.sentSize ? "Sent to Executor · " + money(d.sentSize) : "Sent to Executor"}</div>`
    : `<div class="headline dn">Rejected · ${esc(d.reason)}</div><div class="mut">Grok Bot won't buy ${name}</div>`;
  const en = S.sets ? S.sets.values["auditor.enabled"] : true;
  view.innerHTML = top + `<canvas id="disc" class="cv" style="height:150px"></canvas>${head}
    <div class="rows layers" style="margin-top:14px">${d.layers.map((l, i) => `<div class="row"><span class="ck" id="ck${i}"></span><div class="l"><div class="t1">${l.n} · ${esc(l.name)}</div><div class="t2" id="lv${i}"></div></div></div>`).join("")}</div>
    <div class="rows" style="margin-top:14px"><div class="kv"><span>Take apart before buying</span><span class="sw ${en ? "on" : ""}" aria-disabled="true"></span></div></div>
    <div class="note">Read-only here. From Telegram: set auditor.enabled to false (asks twice).</div>
    <a class="btn" href="${esc(d.coin_url)}" target="_blank" rel="noopener">Open on FOMO</a>`;
  const paint = () => {
    const st = [];
    d.layers.forEach((l, i) => {
      let s = "";
      if (i < b.shown) s = l.pass ? "g" : "r"; else if (i === b.shown && (b.busy || (d.running && i === got))) s = "b";
      st.push(s);
      const ck = $("#ck" + i), lv = $("#lv" + i); if (!ck) return;
      ck.className = "ck " + s; ck.innerHTML = s === "g" ? CK : s === "r" ? CX : "";
      lv.textContent = i < b.shown ? l.value : l.pass === null && !d.running && i >= got ? l.value : i === b.shown && s === "b" ? "reading..." : "";
    });
    K.discs($("#disc"), st);
  };
  paint();
  const step = () => {   // beam: 350ms per layer, then 150ms to green/red; never past what the server sent
    if (S.screen !== "audit" || b.shown >= got) { b.busy = false; paint(); return; }
    b.busy = true; paint();
    setTimeout(() => { b.busy = false; b.shown++; paint(); setTimeout(step, 150); }, 350);
  };
  if (!b.started && b.shown < got) { b.started = true; step(); }
}
function render() {
  errRow();
  if (!creds) { view.innerHTML = `<div style="padding-top:30vh;text-align:center"><div class="headline">Desk</div><div class="mut" style="margin-top:8px">Open this app with your one-time link from Telegram.</div></div>`; return; }
  if (!S.st) { view.innerHTML = S.err ? `<div class="emptyrow" style="margin-top:30vh">${S.err.kind === 404 ? "No desk data at this link" : "Can't reach the desk"}</div>` : S.tab === "home" ? skHome() : skList(); return; }
  if (S.screen === "coin") return coinScreen();
  if (S.screen === "audit") return auditScreen();
  ({home, agents: agentsTab, activity: activityTab, account: accountTab})[S.tab]();
  $$("canvas.ring").forEach(cv => K.ring(cv, cv.dataset.score === "" ? null : +cv.dataset.score, +cv.dataset.min));
}
addEventListener("resize", () => S.st && render());
creds = takeKey();
render();
if (creds) { refresh(); setInterval(() => { if (Date.now() >= S.nextTry) refresh(); }, 1000); }
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
// test hook for screenshots (no data, no secrets)
window.__desk = {S, render, go, open};
})();
