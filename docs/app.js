/* Easy Keto Carnivore Cookbook — app
   Static single-page app: search, filters, recipe view with serving scaler, cook mode + timers,
   favorites/notes/ratings, meal planner, shopping list, "what can I make", backup. Data in recipes.js. */
(() => {
"use strict";
const D = window.COOKBOOK, M = D.meta, R = D.recipes;
const byId = new Map(R.map(r => [r.i, r]));
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $("#app");
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const color = r => M.colors[r.c];
const SLOTS = [["B", "Breakfast"], ["L", "Lunch"], ["D", "Dinner"], ["S", "Snack"]];
const LISTS = [["fav", "Favorites", "♥", "#d64545"], ["want", "Want to try", "☆", "#c9822b"], ["liked", "Tried · liked", "👍", "#3f7a4a"], ["dis", "Tried · didn't like", "👎", "#8a8079"]];
const inList = (r, l) => l === "fav" ? !!S.fav[r.i] : S.status[r.i] === l;
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/* ---------- saved state (this device only) ---------- */
const KEY = "ekc:v1";
const DEF = () => ({ fav: {}, status: {}, timers: [], notes: {}, rating: {}, made: {}, eat: {}, mine: {}, recent: [], plan: {}, list: [], pantry: [],
  pantryFats: true, goals: { kcal: 2000, p: 150, f: 140, c: 20 }, people: 1, theme: null });
let S;
try { S = Object.assign(DEF(), JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { S = DEF(); }
let saveT;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast("Could not save: storage is full"); } }, 120); counts(); if (window.__syncSoon) window.__syncSoon(); }
function counts() {
  const f = Object.keys(S.fav).length, l = S.list.filter(x => !x.done).length;
  const mine = f + Object.keys(S.status).filter(k => S.status[k] === "want").length;
  $("#favCt").textContent = mine || ""; $("#favCt").style.display = mine ? "" : "none";
  $("#listCt").textContent = l || ""; $("#listCt").style.display = l ? "" : "none";
}

/* ---------- search index ---------- */
function indexRecipe(r) {
  r.tot = r.p + r.k;
  r._t = norm(r.t);
  r._g = norm(r.g.join(" | "));
  r._d = norm(r.d.join(" ") + " " + r.x);
  r._tag = norm([M.cats[r.c], ...r.m.map(i => M.ing[i]), ...r.h.map(i => M.meth[i]),
    r.b ? "budget cheap" : "", r.tot <= 20 ? "quick fast easy 20 minutes" : "", r.k === 0 ? "no cook" : "", r.mine ? "my own recipe mine" : ""].join(" "));
}
R.forEach(indexRecipe);
// Your own recipes live in S.mine (synced) and are merged into the same list as the book's recipes.
function loadMine() {
  for (let i = R.length - 1; i >= 0; i--) if (R[i].mine) { byId.delete(R[i].i); R.splice(i, 1); }
  for (const r of Object.values(S.mine || {})) {
    if (!r || !r.i || !r.t) continue;
    const x = Object.assign({ m: [], h: [], b: 0, u: "", x: "" }, r, { mine: true });
    indexRecipe(x); R.push(x); byId.set(x.i, x);
  }
}
const NUMF = /\b(calories|calorie|cals?|kcal|protein|fat|net ?carbs?|carbs?|time|minutes|mins?|serves|servings)\s*(<=|>=|<|>|=)\s*(\d+(?:\.\d+)?)/gi;
function parseQuery(q) {
  const out = { inc: [], exc: [], num: [], raw: q.trim() };
  let s = norm(q).replace(NUMF, (_, k, op, v) => {
    k = k.replace(/\s/g, "");
    const f = /^(calories|calorie|cals?|kcal)$/.test(k) ? "kcal" : k === "protein" ? "p" : k === "fat" ? "f" :
      /carb/.test(k) ? "c" : /^(serves|servings)$/.test(k) ? "s" : "tot";
    out.num.push([f, op, +v]); return " ";
  });
  s = s.replace(/(-?)"([^"]+)"/g, (_, neg, ph) => { (neg ? out.exc : out.inc).push(ph.trim()); return " "; });
  for (const w of s.split(/\s+/).filter(Boolean)) {
    if (w.startsWith("-") && w.length > 1) out.exc.push(w.slice(1));
    else if (!["and", "with", "the", "a", "of", "recipe", "recipes"].includes(w)) out.inc.push(w);
  }
  return out;
}
const variants = w => { const v = [w]; if (w.length > 3 && w.endsWith("es")) v.push(w.slice(0, -2)); if (w.length > 3 && w.endsWith("s")) v.push(w.slice(0, -1)); return v; };
const NV = r => ({ kcal: r.n[0], p: r.n[1], f: r.n[2], c: r.n[3], s: r.s, tot: r.tot });
function cmp(a, op, b) { return op === "<" ? a < b : op === ">" ? a > b : op === "<=" ? a <= b : op === ">=" ? a >= b : a === b; }
function scoreRecipe(r, pq) {
  for (const [f, op, v] of pq.num) if (!cmp(NV(r)[f], op, v)) return -1;
  for (const w of pq.exc) if (r._t.includes(w) || r._g.includes(w) || r._tag.includes(w)) return -1;
  let sc = 0;
  for (const w of pq.inc) {
    let best = 0;
    for (const v of variants(w)) {
      if (new RegExp("\\b" + v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(r._t)) best = Math.max(best, 12);
      else if (r._t.includes(v)) best = Math.max(best, 8);
      if (r._tag.includes(v)) best = Math.max(best, 5);
      if (r._g.includes(v)) best = Math.max(best, 4);
      if (r._d.includes(v)) best = Math.max(best, 1);
    }
    if (!best) return -1;
    sc += best;
  }
  if (pq.inc.length && r._t === pq.inc.join(" ")) sc += 30;
  return sc || 0.5;
}
function hl(text, pq) {
  let h = esc(text);
  const terms = (pq ? pq.inc : []).filter(t => t.length > 1).sort((a, b) => b.length - a.length);
  if (!terms.length) return h;
  const rx = new RegExp("(" + terms.map(t => esc(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi");
  return h.replace(/(<[^>]*>)|([^<]+)/g, (m, tag, txt) => tag || txt.replace(rx, "<mark>$1</mark>"));
}
function snippet(r, pq) {
  if (!pq || !pq.inc.length) return "";
  const t = pq.inc.find(w => !r._t.includes(w));
  if (!t) return "";
  const line = r.g.find(l => norm(l).includes(t)) || [...r.d, r.x].find(l => norm(l).includes(t));
  return line ? hl(line, pq) : "";
}

/* ---------- filters ---------- */
const F = { cats: new Set(), time: 0, meth: new Set(), ing: -1, budget: false, lists: new Set(), hideDis: true, maxK: 1300, minP: 0, maxC: 10, sort: "rel" };
let Q = "";
const fActive = () => F.cats.size || F.time || F.meth.size || F.ing >= 0 || F.budget || F.lists.size || F.maxK < 1300 || F.minP > 0 || F.maxC < 10;
function results() {
  const pq = parseQuery(Q);
  let out = [];
  for (const r of R) {
    if (F.cats.size && !F.cats.has(r.c)) continue;
    if (F.time && r.tot > F.time) continue;
    if (F.meth.size && ![...F.meth].some(m => r.h.includes(m))) continue;
    if (F.ing >= 0 && !r.m.includes(F.ing)) continue;
    if (F.budget && !r.b) continue;
    if (F.lists.size && ![...F.lists].some(l => inList(r, l))) continue;
    if (F.hideDis && S.status[r.i] === "dis" && !F.lists.has("dis")) continue;
    if (F.maxK < 1300 && r.n[0] > F.maxK) continue;
    if (r.n[1] < F.minP) continue;
    if (F.maxC < 10 && r.n[3] > F.maxC) continue;
    const sc = scoreRecipe(r, pq);
    if (sc < 0) continue;
    out.push([r, sc]);
  }
  const by = {
    rel: (a, b) => b[1] - a[1] || a[0].i - b[0].i,
    name: (a, b) => a[0].t.localeCompare(b[0].t),
    kcal: (a, b) => a[0].n[0] - b[0].n[0],
    prot: (a, b) => b[0].n[1] - a[0].n[1],
    pcal: (a, b) => b[0].n[1] / Math.max(b[0].n[0], 1) - a[0].n[1] / Math.max(a[0].n[0], 1),
    carb: (a, b) => a[0].n[3] - b[0].n[3],
    time: (a, b) => a[0].tot - b[0].tot,
    rate: (a, b) => (S.rating[b[0].i] || 0) - (S.rating[a[0].i] || 0),
  }[F.sort] || ((a, b) => a[0].i - b[0].i);
  out.sort(by);
  return { list: out.map(x => x[0]), pq };
}

/* ---------- formatting ---------- */
const fmtT = m => m === 0 ? "No cook" : m < 60 ? m + " min" : Math.floor(m / 60) + " hr" + (m % 60 ? " " + (m % 60) + " min" : "");
const fmtK = k => String(k < 50 ? Math.round(k / 5) * 5 : Math.round(k / 10) * 10);
const fmtC = c => c < 0.5 ? "0 g" : c < 1 ? "<1 g" : Math.round(c) + " g";
const FR = [[0, ""], [1 / 8, "1/8"], [1 / 4, "1/4"], [1 / 3, "1/3"], [3 / 8, "3/8"], [1 / 2, "1/2"], [5 / 8, "5/8"], [2 / 3, "2/3"], [3 / 4, "3/4"], [7 / 8, "7/8"], [1, ""]];
function fmtQ(x) {
  if (x >= 20) return String(Math.round(x));
  if (x >= 5 && Math.abs(x - Math.round(x)) > 0.12 && Math.abs(x * 2 - Math.round(x * 2)) < 0.12) return String(Math.round(x * 2) / 2);
  let w = Math.floor(x), f = x - w, best = FR[0];
  for (const fr of FR) if (Math.abs(fr[0] - f) < Math.abs(best[0] - f)) best = fr;
  if (best[0] === 1) { w += 1; best = FR[0]; }
  if (!w && !best[1]) return x > 0 ? "1/8" : "0";
  return (w ? w : "") + (w && best[1] ? " " : "") + best[1];
}
const QRX = /^(\d+(?:\.\d+)?(?:\/\d+)?)(?:\s+to\s+(\d+(?:\.\d+)?(?:\/\d+)?))?\s+/;
const num = s => s.includes("/") ? s.split("/")[0] / s.split("/")[1] : +s;
function scaleLine(line, k) {
  const m = line.match(QRX);
  if (!m) return { q: "", rest: line };
  if (k === 1) return { q: m[0].trim(), rest: line.slice(m[0].length) };
  const a = fmtQ(num(m[1]) * k), b = m[2] ? fmtQ(num(m[2]) * k) : "";
  return { q: a + (b && b !== a ? " to " + b : ""), rest: line.slice(m[0].length) };
}

/* ---------- small UI helpers ---------- */
function toast(msg) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2400);
}
function modal(html, onMount) {
  const bg = document.createElement("div"); bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { bg.remove(); document.removeEventListener("keydown", key); };
  const key = e => { if (e.key === "Escape") close(); };
  bg.addEventListener("click", e => { if (e.target === bg || e.target.closest("[data-close]")) close(); });
  document.addEventListener("keydown", key);
  document.body.appendChild(bg);
  onMount && onMount($(".modal", bg), close);
  const f = $("input,select,button", bg); f && f.focus();
  return close;
}
const ICON = {
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/></svg>',
  chef: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 13.9A4 4 0 0 1 7.5 6a5 5 0 0 1 9 0A4 4 0 0 1 18 13.9V21H6z"/><path d="M6 17h12"/></svg>',
  print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>',
  iosShare: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M8 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-2"/></svg>',
  iosAdd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>',
  iosMore: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18" cy="12" r="1.8"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
  filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 3H2l8 9.5V19l4 2v-8.5z"/></svg>',
};
function statusPill(id) {
  const st = S.status[id]; if (!st) return "";
  const L = LISTS.find(x => x[0] === st);
  return `<span class="pill st-${st}" data-st="${id}">${L[2]} ${esc(L[1])}</span>`;
}
function card(r, pq) {
  const sn = snippet(r, pq);
  return `<a class="card" href="#/r/${r.i}">
    <div class="band" style="background:${color(r)}"></div>
    <div class="body">
      <div class="cat" style="color:${color(r)}">${esc(M.cats[r.c])} · #${r.i}</div>
      <h3>${hl(r.t, pq)}</h3>
      ${sn ? `<div class="snip">…${sn}</div>` : ""}
      <div class="meta"><span class="pill">${fmtT(r.tot)}</span><span class="pill">${fmtK(r.n[0])} cal</span><span class="pill">${r.n[1]} g protein</span><span class="pill">${fmtC(r.n[3])} carbs</span>${S.rating[r.i] ? `<span class="pill" style="color:#b88700">${"★".repeat(S.rating[r.i])}</span>` : ""}${statusPill(r.i)}</div>
    </div>
    <button class="heart ${S.fav[r.i] ? "on" : ""}" data-fav="${r.i}" aria-label="Favorite" title="Favorite">${ICON.heart}</button>
  </a>`;
}
document.addEventListener("click", e => {
  const h = e.target.closest("[data-fav]");
  if (!h) return;
  e.preventDefault(); e.stopPropagation();
  const id = +h.dataset.fav;
  if (S.fav[id]) delete S.fav[id]; else S.fav[id] = Date.now();
  save(); $$(`[data-fav="${id}"]`).forEach(b => b.classList.toggle("on", !!S.fav[id]));
  if (h.classList.contains("btn")) h.innerHTML = ICON.heart + (S.fav[id] ? " Saved" : " Favorite");
});
function grid(list, pq, el, step = 48) {
  let shown = 0;
  const g = document.createElement("div"); g.className = "grid";
  const more = document.createElement("div"); more.className = "more";
  el.append(g, more);
  const add = () => {
    g.insertAdjacentHTML("beforeend", list.slice(shown, shown + step).map(r => card(r, pq)).join(""));
    shown += step;
    more.innerHTML = shown < list.length ? `<button class="btn">Show more (${list.length - shown} left)</button>` : "";
  };
  more.addEventListener("click", add);
  add();
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(es => { if (es[0].isIntersecting && shown < list.length) add(); }, { rootMargin: "600px" });
    io.observe(more);
  }
}

/* ---------- views ---------- */
function setTab(name) { $$("#tabs a").forEach(a => a.classList.toggle("on", a.dataset.r === name)); }

function viewBrowse(opts = {}) {
  setTab("home");
  const { list, pq } = results();
  const showHero = !Q && !fActive() && !opts.fav;
  app.innerHTML = `
  ${showHero ? `<div class="hero">${M.cats.map((c, i) => `<a href="#/" data-cat="${i}" style="background:${M.colors[i]}"><b>${esc(c)}</b><span>${R.filter(r => r.c === i).length} recipes</span></a>`).join("")}</div><a class="guide-link" href="#/guide">🌡️ <span><b>Before you start</b> · safe cooking temperatures, pantry staples, and tips</span><span aria-hidden="true">›</span></a>` : ""}
  <div class="browse">
    <aside class="filters" id="filters" aria-label="Filters">${filtersHTML()}</aside>
    <section>
      <div class="resbar">
        <h2>${opts.fav ? "Favorites" : Q ? `Results for “${esc(Q)}”` : "All recipes"} <span class="muted" style="font:600 15px var(--sans)">${list.length.toLocaleString()}</span></h2>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn sm showfilters" id="showF">${ICON.filter} Filters${fActive() ? " •" : ""}</button>
          <label class="sr" for="sort">Sort</label>
          <select class="inp" id="sort" style="width:auto">
            ${[["rel", Q ? "Best match" : "Cookbook order"], ["name", "Name A–Z"], ["time", "Quickest"], ["kcal", "Fewest calories"], ["prot", "Most protein"], ["pcal", "Most protein per calorie"], ["carb", "Fewest net carbs"], ["rate", "My ratings"]]
              .map(([v, t]) => `<option value="${v}" ${F.sort === v ? "selected" : ""}>${t}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="active-f">${activeChips()}</div>
      <div id="res"></div>
    </section>
  </div>`;
  const res = $("#res");
  if (!list.length) {
    res.innerHTML = opts.fav && !Object.keys(S.fav).length
      ? `<div class="empty"><b>No favorites yet</b>Tap the heart on any recipe to save it here.</div>`
      : `<div class="empty"><b>No recipes match</b>Try fewer words, or clear a filter.</div>`;
  } else grid(list, pq, res);
  if (opts.fav) {
    const made = Object.keys(S.made).map(Number).filter(i => byId.get(i)).sort((a, b) => S.made[b].slice(-1)[0] - S.made[a].slice(-1)[0]);
    const recent = S.recent.map(i => byId.get(i)).filter(Boolean).slice(0, 12);
    if (made.length) { res.insertAdjacentHTML("beforeend", `<h2 style="margin-top:26px">I made these</h2>`); grid(made.map(i => byId.get(i)), null, res); }
    if (recent.length) { res.insertAdjacentHTML("beforeend", `<h2 style="margin-top:26px">Recently viewed</h2>`); grid(recent, null, res); }
  }
  bindFilters(opts);
}
function filtersHTML() {
  const ch = (on, attr, label, dot) => `<button class="chip ${on ? "on" : ""}" ${attr}>${dot ? `<span class="dot" style="background:${dot}"></span>` : ""}${label}</button>`;
  return `
    <div style="display:flex;justify-content:space-between;align-items:center"><h4>Category</h4><button class="btn sm showfilters" data-closef>Done</button></div>
    <div class="chips">${M.cats.map((c, i) => ch(F.cats.has(i), `data-c="${i}"`, esc(c), M.colors[i])).join("")}</div>
    <h4>Total time</h4>
    <div class="chips">${[[0, "Any"], [20, "≤ 20 min"], [45, "≤ 45 min"], [90, "≤ 90 min"]].map(([v, t]) => ch(F.time === v, `data-t="${v}"`, t)).join("")}</div>
    <h4>Main ingredient</h4>
    <select class="inp" id="fIng"><option value="-1">Any</option>${M.ing.map((g, i) => `<option value="${i}" ${F.ing === i ? "selected" : ""}>${esc(g)}</option>`).join("")}</select>
    <h4>Cooking method</h4>
    <div class="chips">${M.meth.map((m, i) => ch(F.meth.has(i), `data-m="${i}"`, esc(m))).join("")}</div>
    <h4>Nutrition per serving</h4>
    <div class="range"><span>Max calories</span><output id="oK">${F.maxK >= 1300 ? "Any" : F.maxK}</output><input type="range" id="fK" min="100" max="1300" step="50" value="${F.maxK}"></div>
    <div class="range"><span>Min protein</span><output id="oP">${F.minP ? F.minP + " g" : "Any"}</output><input type="range" id="fP" min="0" max="100" step="5" value="${F.minP}"></div>
    <div class="range"><span>Max net carbs</span><output id="oC">${F.maxC >= 10 ? "Any" : F.maxC + " g"}</output><input type="range" id="fC" min="0" max="10" step="1" value="${F.maxC}"></div>
    <h4>My lists</h4>
    <div class="chips">${LISTS.map(([k, t, ic]) => ch(F.lists.has(k), `data-l="${k}"`, `${ic} ${esc(t)}`)).join("")}</div>
    <label class="check" style="margin-top:6px"><input type="checkbox" id="fHD" ${F.hideDis ? "checked" : ""}> Hide recipes I didn't like</label>
    <h4>More</h4>
    <label class="check"><input type="checkbox" id="fB" ${F.budget ? "checked" : ""}> Budget picks</label>
    <button class="btn sm" id="fReset" style="margin-top:12px;width:100%;justify-content:center">Clear all filters</button>`;
}
function activeChips() {
  const c = [];
  F.cats.forEach(i => c.push([`c${i}`, M.cats[i]]));
  if (F.time) c.push(["t", `≤ ${F.time} min`]);
  F.meth.forEach(i => c.push([`m${i}`, M.meth[i]]));
  if (F.ing >= 0) c.push(["i", M.ing[F.ing]]);
  if (F.maxK < 1300) c.push(["k", `≤ ${F.maxK} cal`]);
  if (F.minP) c.push(["p", `≥ ${F.minP} g protein`]);
  if (F.maxC < 10) c.push(["cc", `≤ ${F.maxC} g carbs`]);
  if (F.budget) c.push(["b", "Budget"]);
  F.lists.forEach(l => c.push(["l" + l, LISTS.find(x => x[0] === l)[1]]));
  return c.map(([k, t]) => `<button class="chip" data-x="${k}">${esc(t)} ×</button>`).join("");
}
function bindFilters(opts) {
  const fl = $("#filters"), rerender = () => { saveF(); viewBrowse(opts); };
  $$(".hero [data-cat]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); F.cats = new Set([+a.dataset.cat]); rerender(); }));
  $$("[data-c]", fl).forEach(b => b.onclick = () => { const i = +b.dataset.c; F.cats.has(i) ? F.cats.delete(i) : F.cats.add(i); rerender(); });
  $$("[data-t]", fl).forEach(b => b.onclick = () => { F.time = +b.dataset.t; rerender(); });
  $$("[data-m]", fl).forEach(b => b.onclick = () => { const i = +b.dataset.m; F.meth.has(i) ? F.meth.delete(i) : F.meth.add(i); rerender(); });
  $("#fIng").onchange = e => { F.ing = +e.target.value; rerender(); };
  const live = (id, out, f) => { const el = $(id); el.oninput = () => { f(+el.value); $(out).textContent = el.id === "fK" ? (el.value >= 1300 ? "Any" : el.value) : el.id === "fP" ? (+el.value ? el.value + " g" : "Any") : (el.value >= 10 ? "Any" : el.value + " g"); }; el.onchange = rerender; };
  live("#fK", "#oK", v => F.maxK = v); live("#fP", "#oP", v => F.minP = v); live("#fC", "#oC", v => F.maxC = v);
  $("#fB").onchange = e => { F.budget = e.target.checked; rerender(); };
  $$("[data-l]", fl).forEach(b => b.onclick = () => { const l = b.dataset.l; F.lists.has(l) ? F.lists.delete(l) : F.lists.add(l); rerender(); });
  $("#fHD").onchange = e => { F.hideDis = e.target.checked; rerender(); };
  $("#fReset").onclick = () => { Object.assign(F, { cats: new Set(), time: 0, meth: new Set(), ing: -1, budget: false, lists: new Set(), hideDis: true, maxK: 1300, minP: 0, maxC: 10 }); rerender(); };
  $("#sort").onchange = e => { F.sort = e.target.value; rerender(); };
  $$(".active-f [data-x]").forEach(b => b.onclick = () => {
    const k = b.dataset.x;
    if (k[0] === "c" && k !== "cc") F.cats.delete(+k.slice(1)); else if (k[0] === "m") F.meth.delete(+k.slice(1)); else if (k[0] === "l") F.lists.delete(k.slice(1));
    else ({ t: () => F.time = 0, i: () => F.ing = -1, k: () => F.maxK = 1300, p: () => F.minP = 0, cc: () => F.maxC = 10, b: () => F.budget = false })[k]();
    rerender();
  });
  const sf = $("#showF"); if (sf) sf.onclick = () => fl.classList.add("open");
  $$("[data-closef]", fl).forEach(b => b.onclick = () => fl.classList.remove("open"));
}
function saveF() { try { sessionStorage.setItem("ekc:f", JSON.stringify({ ...F, cats: [...F.cats], meth: [...F.meth], lists: [...F.lists] })); } catch (e) {} }
try { const f = JSON.parse(sessionStorage.getItem("ekc:f") || "null"); if (f) Object.assign(F, f, { cats: new Set(f.cats), meth: new Set(f.meth), lists: new Set(f.lists || []) }); } catch (e) {}

/* ---------- my recipes (lists) ---------- */
function viewMine(tab) {
  setTab("fav");
  const tabs = [...LISTS, ["own", "My own", "✍️", "#6b4a32"], ["made", "Cooked", "✓", "#3f7a4a"], ["recent", "Recently viewed", "🕘", "#6e625b"]];
  tab = tabs.some(t => t[0] === tab) ? tab : "fav";
  const lists = {
    made: Object.keys(S.made).map(Number).filter(i => byId.get(i)).sort((a, b) => S.made[b].slice(-1)[0] - S.made[a].slice(-1)[0]).map(i => byId.get(i)),
    recent: S.recent.map(i => byId.get(i)).filter(Boolean),
    fav: R.filter(r => S.fav[r.i]).sort((a, b) => S.fav[b.i] - S.fav[a.i]),
    own: R.filter(r => r.mine).sort((a, b) => a.t.localeCompare(b.t)),
  };
  const list = lists[tab] || R.filter(r => S.status[r.i] === tab);
  const n = k => (lists[k] || R.filter(r => S.status[r.i] === k)).length;
  const empty = { fav: "Tap the heart on any recipe to save it here.", want: "On a recipe page, tap “☆ Want to try” to build your to-cook list.",
    liked: "After you cook something, mark it “👍 Tried · liked”.", dis: "Recipes you mark “👎 Tried · didn't like” land here and are hidden from browsing and auto-fill.",
    made: "Tap “✓ I made this” on a recipe (or finish Cook mode) to log it.", recent: "Recipes you open show up here.",
    own: "Add family favorites and your own creations. They get nutrition, search, the meal planner and sync, just like the book's recipes." }[tab];
  app.innerHTML = `<h1 style="margin:0 0 10px">My recipes</h1>
    <div class="chips" style="margin-bottom:16px">${tabs.map(([k, t, ic]) => `<a class="chip ${k === tab ? "on" : ""}" href="#/mine/${k}" style="text-decoration:none">${ic} ${esc(t)} <span class="muted">${n(k)}</span></a>`).join("")}</div>
    ${tab === "own" ? `<p style="margin-top:-6px"><a class="btn primary sm" href="#/add" style="text-decoration:none">＋ Add my own recipe</a></p>` : ""}
    ${tab === "want" && list.length ? `<p style="margin-top:-6px"><button class="btn sm" id="wantPlan">${ICON.cal} Put want-to-try recipes in my meal plan</button></p>` : ""}
    ${list.length ? `<p style="margin-top:-6px"><button class="btn sm" id="minePdf">${ICON.print} PDF of these ${list.length} recipe${list.length === 1 ? "" : "s"}</button></p>` : ""}
    <div id="mineRes"></div>`;
  if (!list.length) $("#mineRes").innerHTML = `<div class="empty"><b>Nothing here yet</b>${empty}</div>`;
  else grid(list, null, $("#mineRes"));
  if ($("#minePdf")) $("#minePdf").onclick = e => pdfManyRecipes(list, "My " + tabs.find(t => t[0] === tab)[1], e.currentTarget);
  if ($("#wantPlan")) $("#wantPlan").onclick = () => {
    const q = list.slice(); let added = 0;
    for (let d = 0; d < 7 && q.length; d++) for (const [s] of SLOTS) {
      if (!q.length || planItems(d, s).length) continue;
      const ix = q.findIndex(r => s === "B" ? r.c === 0 : s === "S" ? r.c >= 5 : r.c > 0 && r.c < 5);
      if (ix < 0) continue;
      ((S.plan[d] = S.plan[d] || {})[s] = []).push(q.splice(ix, 1)[0].i); added++;
    }
    save(); toast(added ? `Added ${added} to empty meals` : "No empty meals left that fit"); location.hash = "#/plan";
  };
}


/* ---------- my own recipes: add / edit / delete (synced with your other devices) ---------- */
const MY_ING = [/ground (beef|chuck)/, /ribeye|strip steak|sirloin|filet|t-bone|porterhouse|flank|skirt|hanger|flat iron|picanha|tri-tip|\bsteak/, /roast|brisket|short rib|oxtail|shank|cheek|prime rib/,
  /pork chop|pork loin|tenderloin|cutlet|schnitzel/, /pork shoulder|pork butt|pulled pork|carnitas|spare rib|baby back|country-style/, /pork belly|bacon|pancetta|lardon/, /ground pork/,
  /sausage|chorizo|brat|kielbasa|andouille|\bham\b|salami|pepperoni|prosciutto|hot dog/, /chicken thigh|drumstick|leg quarter/, /chicken breast|chicken tender|cutlets/, /\bwings?\b/,
  /whole chicken|rotisserie|shredded chicken|cooked chicken|ground chicken/, /turkey/, /duck|goose|quail|pheasant|cornish/, /lamb|mutton|goat/, /venison|bison|elk|boar|rabbit|ostrich|antelope/,
  /\beggs?\b|omelet|frittata|quiche|custard|chaffle|waffle|pancake|crepe/, /cheese|cream|butter|ricotta|mascarpone|mozzarella|cheddar|parmesan|feta|brie/];
const MY_METH = [/slow cook/, /pressure cook|instant pot/, /air fr/, /grill/, /smoke/, /sous vide/];
let nutLoad = null;
const loadNut = () => window.ekcNutrition ? Promise.resolve() : nutLoad || (nutLoad = new Promise((ok, bad) => { const s = document.createElement("script"); s.src = "nutrition.js"; s.onload = ok; s.onerror = () => { nutLoad = null; bad(new Error("couldn't load the nutrition calculator")); }; document.head.appendChild(s); }));
const myLines = v => String(v || "").split(/\n+/).map(x => x.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean);
function viewEditor(id) {
  setTab("fav");
  const old = id ? byId.get(id) : null;
  if (id && (!old || !old.mine)) { app.innerHTML = `<div class="empty"><b>Only your own recipes can be edited</b><a href="#/mine/own">My own recipes</a></div>`; return; }
  const r = old || { t: "", c: 1, p: 10, k: 20, s: 4, g: [], d: [], x: "", n: null, nm: false };
  app.innerHTML = `<h1 style="margin:0 0 10px">${old ? "Edit my recipe" : "Add my own recipe"}</h1>
  <div class="box" style="max-width:760px">
    <label class="muted" for="eT">Recipe name</label><input class="inp" id="eT" value="${esc(r.t)}" placeholder="Grandma's Pot Roast" maxlength="90">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-top:10px">
      <div><label class="muted" for="eC">Category</label><select class="inp" id="eC">${M.cats.map((c, i) => `<option value="${i}" ${i === r.c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
      <div><label class="muted" for="eP">Prep (min)</label><input class="inp" id="eP" type="number" inputmode="numeric" min="0" value="${r.p}"></div>
      <div><label class="muted" for="eK">Cook (min)</label><input class="inp" id="eK" type="number" inputmode="numeric" min="0" value="${r.k}"></div>
      <div><label class="muted" for="eS">Serves</label><input class="inp" id="eS" type="number" inputmode="numeric" min="1" value="${r.s}"></div>
    </div>
    <label class="muted" for="eG" style="display:block;margin-top:10px">Ingredients, one per line, with amounts (like “2 lb chuck roast”)</label>
    <textarea class="inp" id="eG" rows="7" style="width:100%;box-sizing:border-box;font:inherit;line-height:1.5" placeholder="2 lb chuck roast&#10;4 tbsp butter&#10;1 cup beef bone broth&#10;Salt to taste">${esc(r.g.join("\n"))}</textarea>
    <label class="muted" for="eD" style="display:block;margin-top:10px">Steps, one per line (times like “20 minutes” get a timer button)</label>
    <textarea class="inp" id="eD" rows="6" style="width:100%;box-sizing:border-box;font:inherit;line-height:1.5" placeholder="Sear the roast in butter.&#10;Add broth, cover, and bake at 300F for 3 hours.">${esc(r.d.join("\n"))}</textarea>
    <label class="muted" for="eX" style="display:block;margin-top:10px">Tip (optional)</label><input class="inp" id="eX" value="${esc(r.x || "")}" maxlength="200">
    <div class="box" style="margin-top:14px;background:var(--soft)">
      <b>Nutrition per serving</b> <span class="muted" style="font-size:13px" id="eNutMsg">calculating…</span>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-top:8px">
        ${[["eN0", "Calories"], ["eN1", "Protein g"], ["eN2", "Fat g"], ["eN3", "Net carbs g"]].map(([k, l]) => `<div><label class="muted" for="${k}">${l}</label><input class="inp" id="${k}" type="number" inputmode="decimal" min="0" step="any"></div>`).join("")}
      </div>
      <label style="display:flex;gap:8px;align-items:center;margin-top:8px;font-size:14px"><input type="checkbox" id="eManual" ${r.nm ? "checked" : ""}> I'll enter nutrition myself (from a label or app)</label>
    </div>
    <div class="row" style="justify-content:space-between;margin-top:14px">
      <span>${old ? `<button class="btn" id="eDel" style="color:#c44">Delete</button>` : ""}</span>
      <span style="display:flex;gap:8px"><a class="btn" href="${old ? "#/r/" + old.i : "#/mine/own"}">Cancel</a><button class="btn primary" id="eSave">Save recipe</button></span>
    </div>
  </div>`;
  const nIn = [0, 1, 2, 3].map(i => $("#eN" + i));
  const setN = n => { nIn[0].value = Math.round(n[0]); nIn[1].value = Math.round(n[1]); nIn[2].value = Math.round(n[2]); nIn[3].value = Math.round(n[3] * 10) / 10; };
  if (r.n) setN(r.n);
  const lockN = () => nIn.forEach(x => x.readOnly = !$("#eManual").checked);
  let est = null;
  const calc = async () => {
    if (!$("#eManual")) return;                                   // left the editor
    if ($("#eManual").checked) { $("#eNutMsg").textContent = "entered by you"; return; }
    try { await loadNut(); } catch (e) { $("#eNutMsg").textContent = "calculator unavailable offline: enter it yourself"; return; }
    if (!$("#eManual")) return;
    est = window.ekcNutrition({ title: $("#eT").value, cat: M.cats[+$("#eC").value], serves: $("#eS").value, ing: myLines($("#eG").value) });
    setN([est.kcal, est.p, est.f, est.c]);
    $("#eNutMsg").innerHTML = est.note ? "estimated, " + esc(est.note) : est.unknown.length ? `estimated · <span style="color:#b5651d">couldn't read: ${est.unknown.map(esc).join(", ")}</span>` : "estimated from your ingredients";
  };
  let ct; const soon = () => { clearTimeout(ct); ct = setTimeout(calc, 400); };
  ["#eT", "#eC", "#eS", "#eG"].forEach(s => $(s).addEventListener("input", soon));
  $("#eManual").onchange = () => { lockN(); calc(); };
  lockN(); calc();
  $("#eSave").onclick = async () => {
    const t = $("#eT").value.trim(), g = myLines($("#eG").value), d = myLines($("#eD").value);
    if (!t) { toast("Give your recipe a name"); $("#eT").focus(); return; }
    if (!g.length) { toast("Add at least one ingredient"); $("#eG").focus(); return; }
    if (!$("#eManual").checked) await calc();
    const k = Math.max(0, +$("#eK").value || 0), text = (t + " " + g.slice(0, 2).join(" ")).toLowerCase(), steps = d.join(" ").toLowerCase();
    const rec = { i: old ? old.i : Math.floor(Date.now() / 1000), t, c: +$("#eC").value, p: Math.max(0, +$("#eP").value || 0), k, s: Math.max(1, Math.round(+$("#eS").value || 1)),
      g, d: d.length ? d : ["Cook and enjoy."], x: $("#eX").value.trim(), n: nIn.map((x, i) => i === 3 ? Math.round((+x.value || 0) * 10) / 10 : Math.round(+x.value || 0)),
      u: !$("#eManual").checked && est && est.note ? est.note : "", nm: $("#eManual").checked,
      m: MY_ING.map((rx, i) => rx.test(text) ? i : -1).filter(i => i >= 0), h: [...MY_METH.map((rx, i) => rx.test(steps + " " + t.toLowerCase()) ? i : -1).filter(i => i >= 0), ...(k === 0 ? [6] : [])],
      b: 0, made: old ? old.made : Date.now() };
    S.mine[rec.i] = rec; save(); loadMine();
    toast(old ? "Saved ✓" : "Added to your recipes ✓"); location.hash = "#/r/" + rec.i;
  };
  if ($("#eDel")) $("#eDel").onclick = () => {
    if (!confirm(`Delete “${old.t}”? This removes it from all your synced devices.`)) return;
    delete S.mine[old.i]; delete S.fav[old.i]; delete S.status[old.i]; delete S.notes[old.i]; delete S.rating[old.i];
    for (const d in S.plan) for (const s in S.plan[d]) S.plan[d][s] = (S.plan[d][s] || []).filter(x => x !== old.i);
    save(); loadMine(); toast("Deleted"); location.hash = "#/mine/own";
  };
}

/* ---------- recipe ---------- */
const TRX = /(\d+(?:\.\d+)?)(?:\s*(?:to|-)\s*(\d+(?:\.\d+)?))?\s*(minutes?|mins?|hours?|hrs?)\b/gi;
function stepHTML(s, label) {
  let out = "", last = 0;
  s.replace(TRX, (m, a, b, u, off) => {
    const sec = Math.round(+a * (/^h/i.test(u) ? 3600 : 60));
    out += esc(s.slice(last, off)) + esc(m) + (sec > 0 && sec <= 172800 ? ` <button class="tbtn no-print" data-timer="${sec}" data-label="${esc(label)}" title="Start a ${esc(m)} timer">⏱ ${fmtT(Math.round(sec / 60)).replace("No cook", "<1 min")}</button>` : "");
    last = off + m.length;
  });
  return out + esc(s.slice(last));
}
let curServ = {};
let shownRecipe = null;
function viewRecipe(id) {
  const same = shownRecipe === id && location.hash.startsWith("#/r/" + id) && !!document.querySelector(".recipe");
  const keepY = same ? window.scrollY : null;
  shownRecipe = id;
  const r = byId.get(id);
  if (!r) { app.innerHTML = `<div class="empty"><b>Recipe not found</b><a href="#/">Back to recipes</a></div>`; return; }
  setTab("");
  if (!same && S.recent[0] !== id) { S.recent = [id, ...S.recent.filter(x => x !== id)].slice(0, 30); save(); }
  const serv = curServ[id] || r.s, k = serv / r.s, c = color(r);
  const { list } = results();
  const pos = list.findIndex(x => x.i === id);
  const prev = pos > 0 ? list[pos - 1] : byId.get(id - 1), next = pos >= 0 && pos < list.length - 1 ? list[pos + 1] : byId.get(id + 1);
  const made = S.made[id] || [];
  const sim = similar(r);
  app.innerHTML = `
  <article class="recipe" style="--c:${c}">
    <div class="r-nav no-print">
      <a class="btn sm" href="#/" id="backBtn">← Back</a>
      <span>${prev ? `<a class="btn sm" href="#/r/${prev.i}" title="${esc(prev.t)}">‹ Prev</a>` : ""} ${next ? `<a class="btn sm" href="#/r/${next.i}" title="${esc(next.t)}">Next ›</a>` : ""}</span>
    </div>
    <div class="r-head" style="background:${c}">
      <div class="kicker">${esc(M.cats[r.c])} · ${r.mine ? "✍️ My own recipe" : "Recipe " + r.i}${r.b ? " · Budget pick" : ""}</div>
      <h1>${esc(r.t)}</h1>
    </div>
    <div class="facts">
      <div class="fact"><small>Prep</small><b>${fmtT(r.p).replace("No cook", "None")}</b></div>
      <div class="fact"><small>Cook</small><b>${fmtT(r.k).replace("No cook", "None")}</b></div>
      <div class="fact"><small>Total</small><b>${fmtT(r.tot)}</b></div>
      <div class="fact"><small>Serves</small><b>${serv}</b></div>
    </div>
    <div class="nut">
      <div class="lbl">Nutrition per serving<br><span style="font-weight:600;text-transform:none;letter-spacing:0">estimated${r.u ? ", " + esc(r.u) : ""}</span></div>
      <div class="v"><b>${fmtK(r.n[0])}</b><span>Calories</span></div>
      <div class="v"><b>${r.n[1]} g</b><span>Protein</span></div>
      <div class="v"><b>${r.n[2]} g</b><span>Fat</span></div>
      <div class="v"><b>${fmtC(r.n[3])}</b><span>Net carbs</span></div>
    </div>
    <div class="r-actions no-print">
      <button class="btn primary" id="cookBtn">${ICON.chef} Cook mode</button>
      <button class="btn ${S.fav[id] ? "on" : ""}" data-fav="${id}">${ICON.heart} ${S.fav[id] ? "Saved" : "Favorite"}</button>
      <button class="btn" id="planBtn">${ICON.cal} Add to plan</button>
      <button class="btn" id="timerBtn2">⏱ Timer</button>
      <button class="btn" id="listBtn">${ICON.cart} Add to shopping list</button>
      <button class="btn" id="printBtn">${ICON.print} PDF / Print</button>
      <button class="btn" id="shareBtn">${ICON.share} Share</button>
      ${r.mine ? `<a class="btn" href="#/edit/${id}" style="text-decoration:none">✏️ Edit</a>` : ""}
    </div>
    <div class="status-row no-print" role="group" aria-label="My list">
      <span class="muted" style="font-size:13px;font-weight:700">My list:</span>
      ${LISTS.slice(1).map(([k, t, ic]) => `<button class="seg ${S.status[id] === k ? "on st-" + k : ""}" data-set="${k}">${ic} ${esc(t)}</button>`).join("")}
    </div>
    <div class="r-cols">
      <div class="box">
        <h3 style="color:${c}">Ingredients</h3>
        <div class="scaler">Servings <button id="sMinus" aria-label="Fewer servings">−</button><b id="sNum">${serv}</b><button id="sPlus" aria-label="More servings">+</button>${k !== 1 ? `<button class="btn sm" id="sReset" style="border-radius:8px;width:auto;height:auto">Reset</button>` : ""}</div>
        <ul class="ings">${r.g.map((g, i) => { const s = scaleLine(g, k); return `<li><input type="checkbox" id="g${i}" aria-label="Got it"><span>${s.q ? `<span class="q">${esc(s.q)}</span> ` : ""}${esc(s.rest)}</span></li>`; }).join("")}</ul>
        ${(() => { const st = safeTemps(r); return st.length ? `<div class="safe"><b>🌡️ Safe temp</b>${st.map(x => `<span>${esc(x)}</span>`).join("")}<a href="#/guide">All temperatures ›</a></div>` : ""; })()}
        ${k !== 1 ? `<p class="muted" style="font-size:12.5px;margin:8px 0 0">Amounts scaled ×${(+k.toFixed(2))}. Cook times stay about the same; larger roasts may need longer.</p>` : ""}
      </div>
      <div>
        <div class="box">
          <h3 style="color:${c}">Directions</h3>
          <ol class="steps">${r.d.map(s => `<li><div>${stepHTML(s, r.t)}</div></li>`).join("")}</ol>
          ${r.x ? `<div class="tip"><b>TIP</b> ${esc(r.x)}</div>` : ""}
        </div>
        <div class="box notes" style="margin-top:14px">
          <h3>My notes</h3>
          <textarea id="notes" placeholder="Tweaks, brands, how long it really took…">${esc(S.notes[id] || "")}</textarea>
          <div class="made">
            <div class="stars" role="radiogroup" aria-label="My rating">${[1, 2, 3, 4, 5].map(n => `<button data-star="${n}" class="${(S.rating[id] || 0) >= n ? "on" : ""}" aria-label="${n} stars">★</button>`).join("")}</div>
            <button class="btn sm" id="madeBtn">✓ I made this</button>
            <span class="muted">${made.length ? `Made ${made.length}× · last ${new Date(made[made.length - 1]).toLocaleDateString()}` : "Not made yet"}</span>
          </div>
        </div>
      </div>
    </div>
    ${sim.length ? `<section class="similar no-print"><h2>You might also like</h2><div class="grid">${sim.map(x => card(x)).join("")}</div></section>` : ""}
  </article>`;
  window.scrollTo({ top: keepY == null ? 0 : keepY, left: 0, behavior: "instant" });   // same recipe re-drawn (stars, servings, lists): stay where you were
  const setServ = v => { curServ[id] = Math.max(1, Math.min(48, v)); viewRecipe(id); };
  $("#sMinus").onclick = () => setServ(serv - 1);
  $("#sPlus").onclick = () => setServ(serv + 1);
  if ($("#sReset")) $("#sReset").onclick = () => { delete curServ[id]; viewRecipe(id); };
  $$("ul.ings li").forEach(li => li.addEventListener("click", e => { const cb = $("input", li); if (e.target !== cb) cb.checked = !cb.checked; li.classList.toggle("got", cb.checked); }));
  const grow = ta => { ta.style.height = "auto"; const lines = Math.max(4, Math.ceil((ta.scrollHeight - 4) / 28) + 1); ta.style.height = (lines * 28 + 4 + 2) + "px"; };
  grow($("#notes")); requestAnimationFrame(() => grow($("#notes")));
  $("#notes").addEventListener("input", e => grow(e.target));
  window.addEventListener("resize", () => { const t = $("#notes"); if (t) grow(t); }, { once: true });
  let nt; $("#notes").oninput = e => { clearTimeout(nt); nt = setTimeout(() => { const v = e.target.value.trim(); if (v) S.notes[id] = e.target.value; else delete S.notes[id]; save(); }, 300); };
  $$("[data-star]").forEach(b => b.onclick = () => { const n = +b.dataset.star; if (S.rating[id] === n) delete S.rating[id]; else S.rating[id] = n; save(); viewRecipe(id); });
  $$("[data-set]").forEach(b => b.onclick = () => { const k = b.dataset.set; if (S.status[id] === k) delete S.status[id]; else S.status[id] = k; save(); viewRecipe(id); toast(S.status[id] ? "Saved to “" + LISTS.find(x => x[0] === k)[1] + "”" : "Removed from your list"); });
  $("#madeBtn").onclick = () => logMade(id);
  $("#timerBtn2").onclick = () => timerDialog(r.t);
  $("#cookBtn").onclick = () => cookMode(r, k);
  $("#planBtn").onclick = () => addToPlanDialog(id);
  $("#listBtn").onclick = () => { addToList([[r, k]]); toast(`Added ${r.g.length} ingredients to your shopping list`); };
  $("#printBtn").onclick = e => pdfOneRecipe(r, k, e.currentTarget);
  warmPDF();
  $("#shareBtn").onclick = async () => {
    const url = location.href.split("#")[0] + "#/r/" + id;
    const text = `${r.t}\n\nIngredients:\n${r.g.map(g => "• " + g).join("\n")}\n\nDirections:\n${r.d.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n${url}`;
    try { if (navigator.share) await navigator.share({ title: r.t, text, url }); else { await navigator.clipboard.writeText(text); toast("Recipe copied to clipboard"); } } catch (e) {}
  };
  $("#backBtn").onclick = e => { if (history.length > 1 && lastRoute && !lastRoute.startsWith("#/r/")) { e.preventDefault(); history.back(); } };
}
function logMade(id) {
  const ts = Date.now();
  (S.made[id] = S.made[id] || []).push(ts); S.eat = S.eat || {}; S.eat[ts] = 1; save();
  const onPage = () => location.hash === "#/r/" + id;
  if (onPage()) viewRecipe(id);
  const rated = S.status[id] === "liked" || S.status[id] === "dis";
  // servings eaten: FitTrack logs this many servings (1 if you skip)
  modal(`<h3>Made ${esc(byId.get(id).t)} 🍳</h3>
    <p class="muted" style="margin:0 0 6px">How much did you eat? FitTrack logs it for you.</p>
    <div class="chips" id="eatChips">${[[0.5, "½"], [1, "1"], [1.5, "1½"], [2, "2"], [3, "3"], [0, "None"]].map(([v, t]) => `<button class="chip ${v === 1 ? "on" : ""}" data-eat="${v}">${t}${v ? ` serving${v > 1 ? "s" : ""}` : ""}</button>`).join("")}</div>
    ${rated ? "" : `<p class="muted" style="margin:12px 0 6px">How was it?</p>
    <div class="row" style="justify-content:flex-start;margin-top:0"><button class="btn" data-how="liked">👍 Liked it</button><button class="btn" data-how="dis">👎 Didn't like it</button></div>`}
    <div class="row"><button class="btn primary" data-close>Done</button></div>`, (m, close) => {
    $$("[data-eat]", m).forEach(b => b.onclick = () => { S.eat[ts] = +b.dataset.eat; save(); $$("[data-eat]", m).forEach(x => x.classList.toggle("on", x === b)); });
    $$("[data-how]", m).forEach(b => b.onclick = () => { S.status[id] = b.dataset.how; save(); close(); toast("Saved to your lists"); if (onPage()) viewRecipe(id); });
  });
}
function similar(r) {
  const sc = R.filter(x => x.i !== r.i).map(x => {
    let s = 0;
    for (const m of x.m) if (r.m.includes(m)) s += 3;
    for (const h of x.h) if (r.h.includes(h)) s += 1;
    if (x.c === r.c) s += 2;
    s -= Math.abs(x.n[0] - r.n[0]) / 400;
    return [x, s];
  }).sort((a, b) => b[1] - a[1]);
  const seed = r.i * 7;
  return sc.slice(0, 14).sort((a, b) => ((a[0].i * seed) % 13) - ((b[0].i * seed) % 13)).slice(0, 6).map(x => x[0]);
}

/* ---------- cook mode ---------- */
let wakeLock = null;
function cookMode(r, k) {
  let i = 0;
  const el = document.createElement("div"); el.className = "cook"; el.setAttribute("role", "dialog");
  document.body.appendChild(el); document.body.style.overflow = "hidden";
  if ("wakeLock" in navigator) navigator.wakeLock.request("screen").then(w => { wakeLock = w; }).catch(() => {});
  const draw = () => {
    el.innerHTML = `
      <div class="cook-top"><b>${esc(r.t)}</b><span style="display:flex;gap:8px"><button class="btn sm" id="ckIng">Ingredients</button><button class="btn sm" id="ckX">Exit ✕</button></span></div>
      <div class="cook-body">
        <div class="cook-ings" id="ckList"><h3 style="margin-top:0">Ingredients</h3><ul class="ings">${r.g.map(g => { const s = scaleLine(g, k); return `<li><input type="checkbox"><span>${s.q ? `<span class="q">${esc(s.q)}</span> ` : ""}${esc(s.rest)}</span></li>`; }).join("")}</ul></div>
        <div class="cook-step"><div class="n">Step ${i + 1} of ${r.d.length}</div><p>${stepHTML(r.d[i], r.t)}</p>${i === r.d.length - 1 && r.x ? `<div class="tip" style="--c:${color(r)}"><b>TIP</b> ${esc(r.x)}</div>` : ""}</div>
      </div>
      <div class="cook-nav"><button class="btn" id="ckPrev" ${i ? "" : "disabled"}>‹ Back</button><div class="dots">${r.d.map((_, j) => `<i class="${j === i ? "on" : ""}"></i>`).join("")}</div>
      ${i < r.d.length - 1 ? `<button class="btn primary" id="ckNext">Next ›</button>` : `<button class="btn primary" id="ckDone">Done ✓</button>`}</div>`;
    $("#ckX", el).onclick = close; $("#ckIng", el).onclick = () => $("#ckList", el).classList.toggle("open");
    if ($("#ckPrev", el)) $("#ckPrev", el).onclick = () => { if (i) { i--; draw(); } };
    if ($("#ckNext", el)) $("#ckNext", el).onclick = () => { i++; draw(); };
    if ($("#ckDone", el)) $("#ckDone", el).onclick = () => { close(); logMade(r.i); };
    $$("li", el).forEach(li => li.onclick = e => { const cb = $("input", li); if (e.target !== cb) cb.checked = !cb.checked; li.classList.toggle("got", cb.checked); });
  };
  const key = e => { if (e.key === "ArrowRight" || e.key === " ") { if (i < r.d.length - 1) { i++; draw(); } e.preventDefault(); } else if (e.key === "ArrowLeft") { if (i) { i--; draw(); } } else if (e.key === "Escape") close(); };
  function close() { el.remove(); document.body.style.overflow = ""; document.removeEventListener("keydown", key); try { wakeLock && wakeLock.release(); } catch (e) {} wakeLock = null; }
  document.addEventListener("keydown", key);
  let sx = null; el.addEventListener("touchstart", e => sx = e.touches[0].clientX, { passive: true });
  el.addEventListener("touchend", e => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 60) { if (dx < 0 && i < r.d.length - 1) i++; else if (dx > 0 && i) i--; draw(); } sx = null; });
  draw();
}

/* ---------- lock-screen timer alerts via the push server (optional) ---------- */
const PUSH = String((window.EKC_PUSH || {}).server || "").replace(/\/+$/, "");
const pushSupported = () => !!(PUSH && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
let pushWarned = false;
const b64uToBytes = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
async function pushSub() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
async function enablePush() {
  if (!PUSH) { toast("Timer alert server isn't set up yet (see README)"); return false; }
  if (isIOS && !isStandalone()) { modal(`<h3>Add to Home Screen first</h3><p>On iPhone, lock-screen alerts work once the cookbook is on your Home Screen:</p>${iosInstallSteps()}<p>Then tap <b>⏱ → Turn on lock-screen alerts</b> again.</p><div class="row"><button class="btn primary" data-close>OK</button></div>`); return false; }
  if (!pushSupported()) { toast("This browser can't receive lock-screen alerts"); return false; }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Alerts are blocked. Allow notifications for this app in your phone settings."); return false; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { publicKey } = await (await fetch(PUSH + "/vapid")).json();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(publicKey) });
    }
    S.pushOn = true; save();
    for (const t of T) if (!t.done && !t.paused) pushSync("schedule", t);
    toast("Lock-screen alerts are on");
    return true;
  } catch (e) { console.warn(e); toast("Couldn't turn on alerts: " + (e.message || e)); return false; }
}
async function disablePush() {
  try { const sub = await pushSub(); if (sub) { for (const t of T) pushSync("cancel", t, sub); await sub.unsubscribe(); } } catch (e) {}
  S.pushOn = false; save(); toast("Lock-screen alerts are off");
}
async function pushSync(op, t, subIn) {
  if (!S.pushOn || !PUSH) return;
  try {
    const sub = subIn || await pushSub();
    if (!sub) { S.pushOn = false; save(); return; }
    const body = { sub: sub.toJSON(), id: String(t.id) };
    if (op === "schedule") Object.assign(body, { end: Math.round(t.end), label: t.label });
    const r = await fetch(PUSH + "/" + op, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error("server " + r.status);
    t.pushed = op === "schedule"; save();
  } catch (e) {
    t.pushed = false;
    if (!pushWarned) { pushWarned = true; toast("No connection to the alert server. Alarm still rings while the app is open."); }
  }
}
async function pushTest() {
  const sub = await pushSub();
  if (!sub) return enablePush();
  const r = await fetch(PUSH + "/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sub: sub.toJSON() }) }).catch(() => null);
  toast(r && r.ok ? "Test alert on its way. Lock your phone to see it." : "Couldn't reach the alert server");
}
if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", e => {
  if (e.data && e.data.type === "timer-pushed") { const t = T.find(x => String(x.id) === String(e.data.id)); if (t) { t.notified = true; save(); } }
});
// If the phone dropped the subscription (or notifications were turned off), stop pretending alerts are on.
if (S.pushOn) pushSub().then(sub => { if (!sub || Notification.permission !== "granted") { S.pushOn = false; save(); } }).catch(() => {});

/* ---------- timers: step timers + a standalone kitchen timer, saved across reloads ---------- */
let tTick = null, audio = null;
const T = S.timers;                       // [{id,end,left,paused,label,done,notified}]
function timersFromState() { const saved = [...(S.timers || [])]; T.length = 0; saved.forEach(t => T.push(t)); S.timers = T; drawTimers(); if (T.length && !tTick) tTick = setInterval(drawTimers, 500); }
document.addEventListener("click", e => {
  const b = e.target.closest("[data-timer]"); if (!b) return;
  e.preventDefault();
  startTimer(+b.dataset.timer, b.dataset.label + " · " + b.textContent.replace("⏱", "").trim());
});
function unlockSound() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch (e) {} }
function askNotify() { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().then(() => drawTimers()).catch(() => {}); }
function startTimer(sec, label) {
  unlockSound(); askNotify();
  const t = { id: Date.now() + Math.random(), end: Date.now() + sec * 1000, left: sec * 1000, paused: false, label: label || "Timer", done: false, notified: false };
  T.push(t); save(); drawTimers(); if (!tTick) tTick = setInterval(drawTimers, 500);
  pushSync("schedule", t);
  toast(S.pushOn ? "Timer started · you'll get an alert even if the app is closed" : "Timer started");
}
function beep() {
  if (!audio || audio.state !== "running") return;
  const t0 = audio.currentTime;
  for (let n = 0; n < 3; n++) { const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = 880; o.connect(g); g.connect(audio.destination); g.gain.setValueAtTime(0.0001, t0 + n * 0.35); g.gain.exponentialRampToValueAtTime(0.4, t0 + n * 0.35 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + n * 0.35 + 0.25); o.start(t0 + n * 0.35); o.stop(t0 + n * 0.35 + 0.3); }
}
async function notify(t) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (S.pushOn && t.pushed && !document.hidden) return;   // app is open: the red timer + beeps are the alert; server banner uses the same tag
  const opts = { body: t.label, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "timer-" + t.id, renotify: true, requireInteraction: true, vibrate: [400, 200, 400, 200, 400] };
  try { const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) return reg.showNotification("⏰ Timer done", opts); } catch (e) {}
  try { new Notification("⏰ Timer done", opts); } catch (e) {}
}
const baseTitle = document.title;
function drawTimers() {
  const box = $("#timers"), now = Date.now();
  let anyDone = false;
  for (const t of T) {
    if (!t.paused) t.left = t.end - now;
    if (t.left <= 0 && !t.done) { t.done = true; save(); }
    if (t.done) {
      anyDone = true;
      if (!t.notified) { t.notified = true; save(); notify(t); beep(); try { navigator.vibrate && navigator.vibrate([400, 200, 400, 200, 400]); } catch (e) {} }
      else if (Math.floor((now - t.end) / 500) % 12 === 0) beep();
    }
  }
  document.title = anyDone ? "⏰ Timer done! · " + baseTitle : baseTitle;
  const tb = $("#timerCt"); if (tb) { tb.textContent = T.length || ""; tb.style.display = T.length ? "" : "none"; }
  const fmt = t => { const l = Math.max(0, Math.ceil(t.left / 1000)), h = Math.floor(l / 3600), m = Math.floor(l % 3600 / 60), s = l % 60; return t.done ? "Done!" : (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); };
  const perm = "Notification" in window ? Notification.permission : "na";
  const sig = T.map(t => t.id + (t.done ? "d" : "") + (t.paused ? "p" : "")).join(",") + perm;
  if (sig !== box.dataset.sig) {        // rebuild only when timers are added/removed/paused/finished, so taps never hit a replaced button
    box.dataset.sig = sig;
    box.innerHTML = T.map(t => `<div class="timer ${t.done ? "done" : ""}"><div style="flex:1"><b data-tt="${t.id}">${fmt(t)}</b><small>${esc(t.label)}</small></div>
      ${t.done ? `<button data-tadd="${t.id}" title="Snooze 1 minute">+1 min</button>` : `<button data-tadd="${t.id}" title="Add 1 minute">+1</button><button data-tp="${t.id}" aria-label="${t.paused ? "Resume" : "Pause"}">${t.paused ? "▶" : "❚❚"}</button>`}<button data-tx="${t.id}" aria-label="Stop timer">✕</button></div>`).join("")
      + (T.length && perm === "default" ? `<button class="btn sm" id="tAllow" style="align-self:flex-end">🔔 Allow timer alerts</button>` : "");
  } else for (const t of T) { const el = box.querySelector(`[data-tt="${t.id}"]`); if (el && el.textContent !== fmt(t)) el.textContent = fmt(t); }
  if (!T.length) { clearInterval(tTick); tTick = null; }
}
$("#timers").addEventListener("click", e => {
  const p = e.target.closest("[data-tp]"), x = e.target.closest("[data-tx]"), a = e.target.closest("[data-tadd]");
  unlockSound();
  if (e.target.id === "tAllow") askNotify();
  if (p) { const t = T.find(t => t.id == p.dataset.tp); t.paused = !t.paused; if (!t.paused) { t.end = Date.now() + t.left; pushSync("schedule", t); } else pushSync("cancel", t); }
  if (a) { const t = T.find(t => t.id == a.dataset.tadd); if (t.done) { t.done = false; t.notified = false; t.end = Date.now() + 60000; } else if (t.paused) t.left += 60000; else t.end += 60000; if (!t.paused) pushSync("schedule", t); if (!tTick) tTick = setInterval(drawTimers, 500); }
  if (x) { const t = T.find(t => t.id == x.dataset.tx); if (t && !t.done) pushSync("cancel", t); T.splice(T.indexOf(t), 1); }
  save(); drawTimers();
});
function timerDialog(label) {
  unlockSound();
  const pre = [1, 3, 5, 8, 10, 12, 15, 20, 25, 30, 45, 60, 90, 120];
  modal(`<h3>⏱ Kitchen timer</h3>
    <label class="muted" for="tLbl">Name (optional)</label><input class="inp" id="tLbl" value="${esc(label || "")}" placeholder="e.g. Steak rest, Brisket">
    <div class="chips" style="margin:12px 0">${pre.map(m => `<button class="chip" data-pm="${m}">${m < 60 ? m + " min" : m / 60 + " hr" + (m > 60 ? "s" : "")}</button>`).join("")}</div>
    <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap">
      <label class="muted">Hours<input class="inp" id="tH" type="number" min="0" max="48" value="0" style="width:80px"></label>
      <label class="muted">Minutes<input class="inp" id="tM" type="number" min="0" max="59" value="10" style="width:80px"></label>
      <label class="muted">Seconds<input class="inp" id="tS" type="number" min="0" max="59" value="0" style="width:80px"></label>
      <button class="btn primary" id="tGo">Start</button>
    </div>
    ${pushBlurb()}
    <div class="row"><button class="btn" data-close>Close</button></div>`, (m, close) => {
    const go = sec => { if (sec > 0) { startTimer(sec, $("#tLbl", m).value.trim() || "Timer"); close(); } };
    $$("[data-pm]", m).forEach(b => b.onclick = () => go(+b.dataset.pm * 60));
    $("#tGo", m).onclick = () => go((+$("#tH", m).value || 0) * 3600 + (+$("#tM", m).value || 0) * 60 + (+$("#tS", m).value || 0));
    $("#tLbl", m).focus();
    if ($("#pushOn", m)) $("#pushOn", m).onclick = async () => { if (await enablePush()) { close(); timerDialog(label); } };
  });
}
function pushBlurb() {
  if (S.pushOn) return `<p class="muted" style="font-size:12.5px;margin-bottom:0">🔔 Lock-screen alerts are on: you'll get an alert even if the app is closed. Timers also survive reloads.</p>`;
  if (PUSH) return `<p style="font-size:13px;margin-bottom:0"><button class="btn sm" id="pushOn">🔔 Turn on lock-screen alerts</button> <span class="muted">so timers alert you even when the app is closed.</span></p>`;
  return `<p class="muted" style="font-size:12.5px;margin-bottom:0">Timers keep running if you leave this page or reload, and alert you while the app is open.</p>`;
}
$("#timerBtn").onclick = () => timerDialog("");
document.addEventListener("visibilitychange", () => { if (!document.hidden) drawTimers(); });

/* ---------- meal planner ---------- */
function planItems(d, s) { return ((S.plan[d] || {})[s] || []).filter(id => byId.get(id)); }
function addToPlanDialog(id) {
  const r = byId.get(id);
  modal(`<h3>Add “${esc(r.t)}” to your meal plan</h3>
    <label class="muted" for="pd">Day</label><select class="inp" id="pd">${DAYS.map((d, i) => `<option value="${i}">${d}</option>`).join("")}</select>
    <label class="muted" for="ps" style="display:block;margin-top:8px">Meal</label><select class="inp" id="ps">${SLOTS.map(([k, n]) => `<option value="${k}" ${(r.c === 0 && k === "B") || (r.c >= 5 && k === "S") || (r.c > 0 && r.c < 5 && k === "D") ? "selected" : ""}>${n}</option>`).join("")}</select>
    <div class="row"><button class="btn" data-close>Cancel</button><button class="btn primary" id="pAdd">Add</button></div>`, (m, close) => {
    const today = (new Date().getDay() + 6) % 7; $("#pd", m).value = today;
    $("#pAdd", m).onclick = () => { const d = $("#pd", m).value, s = $("#ps", m).value; ((S.plan[d] = S.plan[d] || {})[s] = (S.plan[d][s] || [])).push(id); save(); close(); toast(`Added to ${DAYS[d]} ${SLOTS.find(x => x[0] === s)[1]}`); };
  });
}
function pickRecipe(title, pool, onPick) {
  modal(`<h3>${esc(title)}</h3><input class="inp" id="pq" type="search" placeholder="Search recipes…">
    <div class="pick" id="pl"></div><div class="row"><button class="btn" data-close>Close</button></div>`, (m, close) => {
    const draw = () => {
      const q = $("#pq", m).value, pq = parseQuery(q);
      const src = q ? R : pool;
      const list = src.map(r => [r, scoreRecipe(r, pq)]).filter(x => x[1] >= 0).sort((a, b) => b[1] - a[1]).slice(0, 80).map(x => x[0]);
      $("#pl", m).innerHTML = list.map(r => `<button data-pick="${r.i}"><i style="background:${color(r)}"></i><span>${hl(r.t, pq)}</span><small class="muted">${fmtK(r.n[0])} cal · ${r.n[1]} g P</small></button>`).join("") || `<p class="muted">No matches.</p>`;
    };
    $("#pq", m).oninput = draw; draw();
    $("#pl", m).onclick = e => { const b = e.target.closest("[data-pick]"); if (b) { onPick(+b.dataset.pick); close(); } };
  });
}
const NOTMEAL = /jerky|pemmican|bresaola|carpaccio|tartare|broth|stock|homemade bacon|beef bacon|corned beef brisket|pastrami \(|summer sausage|rub|seasoning|gravy|sauce|confit\b|consomme|crumbs|chicharrones|cracklings/i;
const meal = r => !NOTMEAL.test(r.t) && r.u === "" && r.k > 0;
const POOL = {
  B: () => R.filter(r => r.c === 0 && r.n[0] >= 200 && !/coffee|steamer|noodles|egg loaf|cloud bread|hard boiled eggs$|pickled/i.test(r.t)),
  L: () => R.filter(r => [1, 2, 3, 4].includes(r.c) && r.tot <= 30 && meal(r) && r.n[0] >= 250),
  D: () => R.filter(r => [1, 2, 3, 4].includes(r.c) && meal(r) && r.n[0] >= 300),
  S: () => R.filter(r => r.c === 5 || r.c === 7),
};
function viewPlan() {
  setTab("plan");
  const g = S.goals;
  app.innerHTML = `
    <div class="plan-head">
      <div><h1 style="margin:0">Meal plan</h1><p class="muted" style="margin:4px 0 0">Daily totals count one serving of each recipe per person.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <span class="scaler" style="margin:0">People <button id="pMinus">−</button><b>${S.people}</b><button id="pPlus">+</button></span>
        <button class="btn" id="autoFill" title="Fill empty meals: favorites, liked and want-to-try first; never ones you didn't like">✨ Auto-fill empty meals</button>
        <button class="btn primary" id="planList">${ICON.cart} Make shopping list</button>
        <button class="btn" id="planPdf">${ICON.print} PDF</button>
        <button class="btn" id="planClear">Clear week</button>
      </div>
    </div>
    <div class="week">${DAYS.map((d, di) => {
      let t = [0, 0, 0, 0];
      const slots = SLOTS.map(([s, n]) => {
        const items = planItems(di, s);
        items.forEach(id => { const r = byId.get(id); t = t.map((v, j) => v + r.n[j]); });
        return `<div class="slot"><small>${n}</small>${items.map((id, ix) => { const r = byId.get(id); return `<div class="it" style="--c:${color(r)}"><a href="#/r/${id}">${esc(r.t)}</a><button data-rm="${di}|${s}|${ix}" aria-label="Remove">✕</button></div>`; }).join("")}<button class="add" data-add="${di}|${s}">+ add</button></div>`;
      }).join("");
      const bar = (v, goal, lbl, unit) => `<div>${lbl} ${Math.round(v)}${unit} / ${goal}${unit}<div class="bar"><i class="${v > goal * 1.1 && lbl !== "Protein" ? "over" : ""}" style="width:${Math.min(100, v / goal * 100)}%"></i></div></div>`;
      return `<div class="day"><h3>${d}</h3>${slots}<div class="tot">${bar(t[0], g.kcal, "Cal", "")}${bar(t[1], g.p, "Protein", "g")}${bar(t[2], g.f, "Fat", "g")}${bar(t[3], g.c, "Carbs", "g")}</div></div>`;
    }).join("")}</div>
    <p class="muted" style="font-size:13px">Change your daily goals in <a href="#/settings">Settings</a>.</p>`;
  $(".week").onclick = e => {
    const a = e.target.closest("[data-add]"), rm = e.target.closest("[data-rm]");
    if (a) { const [d, s] = a.dataset.add.split("|"); pickRecipe(`Add to ${DAYS[d]} ${SLOTS.find(x => x[0] === s)[1]}`, POOL[s]().slice(0, 300), id => { ((S.plan[d] = S.plan[d] || {})[s] = S.plan[d][s] || []).push(id); save(); viewPlan(); }); }
    if (rm) { const [d, s, ix] = rm.dataset.rm.split("|"); S.plan[d][s].splice(+ix, 1); save(); viewPlan(); }
  };
  $("#pMinus").onclick = () => { S.people = Math.max(1, S.people - 1); save(); viewPlan(); };
  $("#pPlus").onclick = () => { S.people = Math.min(20, S.people + 1); save(); viewPlan(); };
  $("#planPdf").onclick = e => {
    const btn = e.currentTarget;
    modal(`<h3>Meal plan PDF</h3><p class="muted" style="margin-top:0">Just the week, or the week plus every recipe in it (one per page)?</p>
      <div class="row" style="justify-content:flex-start"><button class="btn" data-mp="0">Week only</button><button class="btn primary" data-mp="1">Week + recipes</button><button class="btn" data-close>Cancel</button></div>`,
      (m, close) => $$("[data-mp]", m).forEach(b => b.onclick = () => { close(); pdfMealPlan(btn, b.dataset.mp === "1"); }));
  };
  $("#planClear").onclick = () => { if (confirm("Clear the whole week?")) { S.plan = {}; save(); viewPlan(); } };
  $("#autoFill").onclick = () => {
    const favs = new Set([...Object.keys(S.fav).map(Number), ...Object.keys(S.status).filter(k => S.status[k] !== "dis").map(Number)]), used = new Set();
    for (let d = 0; d < 7; d++) for (const [s] of SLOTS) {
      if (planItems(d, s).length || (s === "S" && Math.random() < 0.5)) continue;
      let pool = POOL[s]().filter(r => !used.has(r.i) && S.status[r.i] !== "dis");
      const fp = pool.filter(r => favs.has(r.i));
      if (fp.length && Math.random() < 0.6) pool = fp;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      if (pick) { used.add(pick.i); ((S.plan[d] = S.plan[d] || {})[s] = []).push(pick.i); }
    }
    save(); viewPlan(); toast("Filled empty meals. Swap anything you don't like.");
  };
  $("#planList").onclick = () => {
    const cnt = new Map();
    for (let d = 0; d < 7; d++) for (const [s] of SLOTS) for (const id of planItems(d, s)) cnt.set(id, (cnt.get(id) || 0) + 1);
    if (!cnt.size) return toast("Your plan is empty");
    addToList([...cnt].map(([id, n]) => { const r = byId.get(id); return [r, n * S.people / r.s]; }));
    location.hash = "#/list";
  };
}

/* ---------- shopping list ---------- */
const UNITS = { lb: ["oz", 16], lbs: ["oz", 16], oz: ["oz", 1], cup: ["tsp", 48], cups: ["tsp", 48], tbsp: ["tsp", 3], tsp: ["tsp", 1] };
const SKIP = /^(water|ice)\b|\bwater to cover\b|\bto taste\b/i;
function parseIng(line) {
  if (/optional/i.test(line)) return null;
  const m = line.match(QRX);
  let q = null, rest = line;
  if (m) { q = num(m[2] || m[1]); if (m[2]) q = (num(m[1]) + num(m[2])) / 2; rest = line.slice(m[0].length); }
  let unit = "";
  const um = rest.match(/^(lbs?|oz|cups?|tbsp|tsp|slices?|links?|racks?|cans?|bags?)\b\.?\s+(.*)$/i);
  if (um && q != null) { unit = um[1].toLowerCase(); rest = um[2]; }
  let name = rest.replace(/\(.*?\)/g, "").split(",")[0].replace(/^(of|large|medium|small)\s+/i, "").trim();
  if (!name || SKIP.test(name)) return null;
  return { q, unit, name };
}
function group(name) {
  const n = name.toLowerCase();
  if (/salt|pepper|powder|paprika|cumin|oregano|thyme|rosemary|sage|cinnamon|nutmeg|seasoning|flakes|cayenne|extract|vinegar|sweetener|hot sauce|coriander|allspice|dill|bay|spice|gelatin|aminos|mustard|mayo|ranch|dressing|ketchup|cocoa|espresso|baking|cream of tartar|curing|smoke|ginger|turmeric|masala|curry|fennel|caraway|anise|chili/.test(n)) return "Seasonings & pantry";
  if (/broth|stock|tallow|lard|\boil\b|ghee|duck fat|schmaltz|bacon fat|suet|fatback/.test(n)) return "Fats & broths";
  if (/\begg|cheese|cream|butter|milk|yogurt|mozzarella|parmesan|cheddar|swiss|provolone|gruyere|feta|brie|ricotta|mascarpone|halloumi|gouda|jack|paneer|cotija|queso|camembert|cottage/.test(n)) return "Eggs & dairy";
  if (/beef|steak|ribeye|sirloin|chuck|brisket|rib|pork|bacon|ham|sausage|chorizo|salami|pepperoni|prosciutto|chicken|turkey|duck|lamb|goat|venison|bison|elk|boar|rabbit|quail|pheasant|goose|hen|oxtail|marrow|bones|belly|tenderloin|filet|flank|skirt|hanger|picanha|tri-tip|round|shank|cheeks|wings|thigh|drumstick|breast|kielbasa|brat|hot dog|pastrami|corned|jerky|meatball|mortadella|capicola|bologna|spam|pancetta|lardon|neck|hock|trotter|knuckle|gizzard|feet|carnitas|ostrich|antelope|mutton|rind|chicharr|pellet/.test(n)) return "Meat & poultry";
  return "Other";
}
const GORDER = ["Meat & poultry", "Eggs & dairy", "Fats & broths", "Seasonings & pantry", "Other"];
function addToList(pairs) {
  for (const [r, k] of pairs) for (const line of r.g) {
    const p = parseIng(line); if (!p) continue;
    const key = norm(p.name) + "|" + (UNITS[p.unit] ? UNITS[p.unit][0] : p.unit);
    let it = S.list.find(x => x.key === key && !x.done);
    const base = p.q == null ? null : p.q * k * (UNITS[p.unit] ? UNITS[p.unit][1] : 1);
    if (!it) { it = { key, name: p.name, unit: p.unit, base: 0, has: p.q != null, from: [], done: false, g: group(p.name) }; S.list.push(it); }
    if (base != null) { it.base += base; it.has = true; }
    if (!it.from.includes(r.t)) it.from.push(r.t);
  }
  save();
}
function qtyText(it) {
  if (!it.has || !it.base) return "";
  const u = it.unit, fam = UNITS[u] ? UNITS[u][0] : u, b = it.base;
  if (fam === "oz") return b >= 16 ? fmtQ(b / 16) + " lb" : fmtQ(b) + " oz";
  if (fam === "tsp") return b >= 12 ? fmtQ(b / 48) + " cup" + (b / 48 > 1 ? "s" : "") : b >= 3 ? fmtQ(b / 3) + " tbsp" : fmtQ(b) + " tsp";
  const n = Math.ceil(b - 0.01) === Math.round(b) ? Math.round(b) : fmtQ(b);
  return n + (u ? " " + u : "");
}
function listText() {
  return GORDER.map(g => { const its = S.list.filter(x => x.g === g && !x.done); return its.length ? g.toUpperCase() + "\n" + its.map(x => "☐ " + [qtyText(x), x.name].filter(Boolean).join(" ")).join("\n") : ""; }).filter(Boolean).join("\n\n");
}
function viewList() {
  setTab("list");
  const open = S.list.filter(x => !x.done).length;
  app.innerHTML = `<div class="list">
    <div class="plan-head"><div><h1 style="margin:0">Shopping list</h1><p class="muted" style="margin:4px 0 0">${open} to buy${S.list.length - open ? ` · ${S.list.length - open} checked` : ""}. Matching items from different recipes are combined.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="lCopy">${ICON.share} Copy / share</button><button class="btn" id="lPrint">${ICON.print} PDF / Print</button><button class="btn" id="lDone">Remove checked</button><button class="btn" id="lAll">Clear all</button></div></div>
    <div class="addrow"><input class="inp" id="lNew" placeholder="Add an item, e.g. 2 dozen eggs"><button class="btn primary" id="lAdd">Add</button></div>
    ${S.list.length ? GORDER.map(g => { const its = S.list.map((x, i) => [x, i]).filter(([x]) => x.g === g); return its.length ? `<div class="grp"><h3>${g}</h3>${its.map(([x, i]) => `<label class="${x.done ? "done" : ""}"><input type="checkbox" data-li="${i}" ${x.done ? "checked" : ""}><span><b>${esc(qtyText(x))}</b> ${esc(x.name)}${x.from.length ? `<small>${esc(x.from.slice(0, 3).join(", "))}${x.from.length > 3 ? ` +${x.from.length - 3} more` : ""}</small>` : ""}</span><button class="x" data-lx="${i}" aria-label="Remove">✕</button></label>`).join("")}</div>` : ""; }).join("")
      : `<div class="empty"><b>Your list is empty</b>Open a recipe and tap “Add to shopping list”, or build a meal plan and tap “Make shopping list”.</div>`}
  </div>`;
  $(".list").addEventListener("change", e => { const i = e.target.dataset.li; if (i != null) { S.list[i].done = e.target.checked; save(); e.target.closest("label").classList.toggle("done", e.target.checked); } });
  $(".list").addEventListener("click", e => { const x = e.target.closest("[data-lx]"); if (x) { e.preventDefault(); S.list.splice(+x.dataset.lx, 1); save(); viewList(); } });
  const add = () => { const v = $("#lNew").value.trim(); if (!v) return; S.list.push({ key: "custom|" + Date.now(), name: v, unit: "", base: 0, has: false, from: [], done: false, g: group(v) }); save(); viewList(); $("#lNew").focus(); };
  $("#lAdd").onclick = add; $("#lNew").onkeydown = e => { if (e.key === "Enter") add(); };
  $("#lDone").onclick = () => { S.list = S.list.filter(x => !x.done); save(); viewList(); };
  $("#lAll").onclick = () => { if (confirm("Clear the whole shopping list?")) { S.list = []; save(); viewList(); } };
  $("#lPrint").onclick = e => { if (!S.list.some(x => !x.done)) return toast("Nothing left to buy"); pdfShoppingList(e.currentTarget); };
  $("#lCopy").onclick = async () => { const t = listText() || "Shopping list is empty"; try { if (navigator.share) await navigator.share({ title: "Shopping list", text: t }); else { await navigator.clipboard.writeText(t); toast("List copied"); } } catch (e) {} };
}

/* ---------- what can I make (pantry) ---------- */
const STAPLE = /\b(salt|pepper|water|powder|paprika|cumin|oregano|thyme|rosemary|sage|cinnamon|nutmeg|seasoning|flakes|cayenne|extract|vanilla|vinegar|baking powder|sweetener|hot sauce|coriander|allspice|dill|parsley|bay|spice|ginger|turmeric|masala|curry|fennel|caraway|anise|chili powder|cream of tartar|liquid smoke|ice)\b/i;
const FATS = /\b(butter|tallow|lard|oil|ghee|duck fat|bacon fat|schmaltz)\b/i;
const BASE = (() => {
  const c = new Map();
  for (const r of R) for (const l of r.g) { const p = parseIng(l); if (!p) continue; const n = norm(p.name).replace(/^(shredded|grated|crumbled|thick-cut|boneless|skinless|fresh|whole|full-fat|unsalted|sliced|diced|cooked|crushed|plain|melted|softened|cold|hard boiled|soft boiled)\s+/g, "").replace(/^(shredded|grated|boneless,? skinless|skin-on)\s+/, ""); if (STAPLE.test(n) || n.length > 26) continue; c.set(n, (c.get(n) || 0) + 1); }
  return [...c].sort((a, b) => b[1] - a[1]).slice(0, 70).map(x => x[0]);
})();
function pantryMatch() {
  const have = S.pantry.map(norm);
  if (!have.length) return [];
  const hit = s => have.some(h => variants(h).some(v => s.includes(v)));
  const out = [];
  for (const r of R) {
    const key = r.g.filter(l => !/optional/i.test(l)).map(norm).filter(l => !STAPLE.test(l.replace(/\(.*?\)/g, "")) || /(cream|cheese|beef|pork|chicken|egg|bacon)/.test(l)).filter(l => !(S.pantryFats && FATS.test(l) && !/(cheese|cream)/.test(l)));
    if (!key.length) continue;
    const got = key.filter(hit);
    if (!got.length) continue;
    out.push({ r, got: got.length, need: key.length, missing: key.filter(l => !hit(l)) });
  }
  return out.sort((a, b) => (a.need - a.got) - (b.need - b.got) || b.got - a.got || a.r.tot - b.r.tot);
}
function viewPantry() {
  setTab("pantry");
  const res = pantryMatch(), full = res.filter(x => x.got === x.need);
  app.innerHTML = `
    <h1 style="margin:0 0 4px">What can I make?</h1>
    <p class="muted" style="margin:0 0 12px">Type what's in your fridge. Salt, pepper and dried spices are assumed.</p>
    <div class="pantry-in" id="pin">${S.pantry.map((p, i) => `<button class="chip" data-pr="${i}">${esc(p)} ×</button>`).join("")}<input id="pIn" list="pDl" placeholder="${S.pantry.length ? "Add another…" : "e.g. ground beef, eggs, cheddar"}" aria-label="Add ingredient"></div>
    <datalist id="pDl">${BASE.map(b => `<option value="${esc(b)}">`).join("")}</datalist>
    <label class="check" style="margin-top:8px"><input type="checkbox" id="pFats" ${S.pantryFats ? "checked" : ""}> I have butter and cooking fats</label>
    <div class="sugg">${BASE.filter(b => !S.pantry.map(norm).includes(b)).slice(0, 24).map(b => `<button class="chip" data-pa="${esc(b)}">+ ${esc(b)}</button>`).join("")}</div>
    ${S.pantry.length ? `<div class="resbar"><h2>${full.length} you can make now <span class="muted" style="font:600 15px var(--sans)">· ${res.length - full.length} more need 1+ item</span></h2>${S.pantry.length ? `<button class="btn sm" id="pClr">Clear</button>` : ""}</div><div class="grid" id="pRes"></div><div class="more" id="pMore"></div>` : `<div class="empty"><b>Add a few ingredients</b>We'll find recipes you can cook right now, and ones that need just one more thing.</div>`}`;
  const addP = v => { v = v.trim().toLowerCase(); if (v && !S.pantry.includes(v)) { S.pantry.push(v); save(); } viewPantry(); $("#pIn").focus(); };
  $("#pIn").onkeydown = e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addP(e.target.value); } else if (e.key === "Backspace" && !e.target.value && S.pantry.length) { S.pantry.pop(); save(); viewPantry(); $("#pIn").focus(); } };
  $("#pIn").onchange = e => { if (BASE.includes(norm(e.target.value))) addP(e.target.value); };
  $("#pin").onclick = e => { const b = e.target.closest("[data-pr]"); if (b) { S.pantry.splice(+b.dataset.pr, 1); save(); viewPantry(); } };
  $(".sugg").onclick = e => { const b = e.target.closest("[data-pa]"); if (b) addP(b.dataset.pa); };
  $("#pFats").onchange = e => { S.pantryFats = e.target.checked; save(); viewPantry(); };
  if ($("#pClr")) $("#pClr").onclick = () => { S.pantry = []; save(); viewPantry(); };
  if ($("#pRes")) {
    let shown = 0;
    const more = () => {
      $("#pRes").insertAdjacentHTML("beforeend", res.slice(shown, shown + 36).map(x => card(x.r).replace('<div class="meta">', `<div class="match ${x.got === x.need ? "full" : ""}">${x.got === x.need ? "✓ You have everything" : `Have ${x.got} of ${x.need} · need: ${esc(x.missing.slice(0, 2).map(l => scaleLine(l, 1).rest.split(",")[0]).join(", "))}${x.missing.length > 2 ? "…" : ""}`}</div><div class="meta">`)).join(""));
      shown += 36; $("#pMore").innerHTML = shown < res.length ? `<button class="btn">Show more</button>` : "";
    };
    $("#pMore").onclick = more; more();
  }
}

/* ---------- PDF: recipes, lists, shopping list, meal plan (works on iPhone home-screen app, where Print is blocked) ---------- */
let jsPDFLoad = null;
function loadJsPDF() {
  if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
  if (!jsPDFLoad) jsPDFLoad = new Promise((ok, bad) => {
    const s = document.createElement("script"); s.src = "vendor/jspdf.umd.min.js";
    s.onload = () => ok(window.jspdf.jsPDF); s.onerror = () => { jsPDFLoad = null; bad(new Error("PDF tool didn't load")); };
    document.head.appendChild(s);
  });
  return jsPDFLoad;
}
const SITE_URL = location.origin + location.pathname.replace(/index\.html$/, "");
// Built-in PDF fonts can't draw emoji or some symbols: swap them for plain text.
const pdfText = s => String(s == null ? "" : s)
  .replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/[⏱✓✔]/g, "").replace(/→/g, "->").replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  .replace(/[\u2028\u2029]/g, " ").replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ–—•…€]/g, "").trim();
const hexRGB = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

function pdfDoc(JsPDF) {
  const doc = new JsPDF({ unit: "pt", format: "letter" });
  const W = 612, H = 792, M = 46;
  const st = { doc, W, H, M, y: M, page: 1 };
  st.ensure = need => { if (st.y + need > H - 56) { st.newPage(); return true; } return false; };
  st.newPage = () => { doc.addPage(); st.page++; st.y = M; };
  st.text = (txt, size, opts = {}) => {
    doc.setFont("helvetica", opts.bold ? "bold" : opts.italic ? "italic" : "normal"); doc.setFontSize(size);
    doc.setTextColor(...(opts.color || [43, 37, 34]));
    const x = opts.x || M, w = opts.w || (W - M - x);
    const lines = doc.splitTextToSize(pdfText(txt), w), lh = size * (opts.lh || 1.32);
    for (const ln of lines) { st.ensure(lh); doc.text(ln, x, st.y + size * 0.82); st.y += lh; }
    return lines.length;
  };
  st.footer = () => {
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(110, 98, 91);
      doc.text("Easy Keto Carnivore Cookbook  ·  " + SITE_URL.replace(/^https?:\/\//, ""), M, H - 26);
      doc.text(i + " / " + n, W - M, H - 26, { align: "right" });
    }
  };
  return st;
}

function pdfRecipe(st, r, k = 1, withNotes = true) {
  const { doc, W, M } = st, col = hexRGB(color(r)), serv = Math.round(r.s * k);
  // header band
  doc.setFont("helvetica", "bold"); doc.setFontSize(22);
  const tl = doc.splitTextToSize(pdfText(r.t), W - 2 * M - 28);
  const bandH = 44 + tl.length * 26;
  st.ensure(bandH + 120);
  doc.setFillColor(...col); doc.roundedRect(M, st.y, W - 2 * M, bandH, 8, 8, "F");
  doc.setTextColor(255, 255, 255); doc.setFontSize(9); doc.setFont("helvetica", "bold");
  doc.text(pdfText(`${D.meta.cats[r.c].toUpperCase()}  ·  RECIPE ${r.i}${r.b ? "  ·  BUDGET PICK" : ""}`), M + 14, st.y + 22);
  doc.setFontSize(22); tl.forEach((ln, i) => doc.text(ln, M + 14, st.y + 48 + i * 26));
  st.y += bandH + 14;
  // facts
  const facts = [["PREP", fmtT(r.p).replace("No cook", "None")], ["COOK", fmtT(r.k).replace("No cook", "None")], ["TOTAL", fmtT(r.tot)], ["SERVES", String(serv)]];
  const fw = (W - 2 * M) / 4;
  facts.forEach(([l, v], i) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...col); doc.text(l, M + i * fw, st.y + 8);
    doc.setFontSize(13); doc.setTextColor(43, 37, 34); doc.text(v, M + i * fw, st.y + 24);
  });
  st.y += 36;
  // nutrition
  doc.setFillColor(243, 236, 226); doc.roundedRect(M, st.y, W - 2 * M, 30, 6, 6, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...col); doc.text("PER SERVING (EST.)", M + 10, st.y + 18.5);
  doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(43, 37, 34);
  doc.text(pdfText(`${fmtK(r.n[0])} cal   ·   ${r.n[1]} g protein   ·   ${r.n[2]} g fat   ·   ${fmtC(r.n[3])} net carbs${r.u ? "   (" + r.u + ")" : ""}`), M + 118, st.y + 19.5);
  st.y += 44;
  const head = t => { st.ensure(40); doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...col); doc.text(t, M, st.y + 9); st.y += 18; };
  // ingredients
  head("INGREDIENTS" + (k !== 1 ? `  (scaled to ${serv} servings)` : ""));
  for (const g of r.g) {
    const s = scaleLine(g, k), line = (s.q ? s.q + " " : "") + s.rest;
    st.ensure(16); doc.setDrawColor(150, 140, 132); doc.setLineWidth(0.8); doc.rect(M + 2, st.y + 2.5, 8, 8);
    st.text(line, 11, { x: M + 18, lh: 1.38 }); st.y += 2;
  }
  st.y += 8;
  // directions
  head("DIRECTIONS");
  r.d.forEach((d, i) => {
    st.ensure(22);
    doc.setFillColor(...col); doc.circle(M + 8, st.y + 7, 8, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(255, 255, 255); doc.text(String(i + 1), M + 8, st.y + 10.4, { align: "center" });
    st.text(d, 11, { x: M + 24, lh: 1.38 }); st.y += 6;
  });
  // tip
  if (r.x) {
    doc.setFont("helvetica", "italic"); doc.setFontSize(10.5);
    const lines = doc.splitTextToSize(pdfText(r.x), W - 2 * M - 62), h = lines.length * 14 + 16;
    st.ensure(h + 8);
    doc.setFillColor(243, 236, 226); doc.roundedRect(M, st.y, W - 2 * M, h, 6, 6, "F"); doc.setFillColor(...col); doc.rect(M, st.y, 4, h, "F");
    doc.setFont("helvetica", "bold"); doc.setTextColor(...col); doc.text("TIP", M + 14, st.y + 18);
    doc.setFont("helvetica", "italic"); doc.setTextColor(43, 37, 34); lines.forEach((ln, i) => doc.text(ln, M + 42, st.y + 18 + i * 14));
    st.y += h + 14;
  }
  // notes: the user's own notes, then lines to write on
  if (withNotes) {
    head("MY NOTES");
    if (S.notes[r.i]) { st.text(S.notes[r.i], 11, { lh: 1.4 }); st.y += 4; }
    const stars = S.rating[r.i] ? "Rating: " + "*".repeat(S.rating[r.i]) + "   " : "";
    const made = (S.made[r.i] || []).length ? `Made ${(S.made[r.i] || []).length}x` : "";
    if (stars || made) { st.text(stars + made, 9.5, { color: [110, 98, 91] }); st.y += 2; }
    doc.setDrawColor(228, 218, 208); doc.setLineWidth(0.7);
    for (let n = 0; n < 4 && st.y + 22 < st.H - 60; n++) { st.y += 22; doc.line(M, st.y, W - M, st.y); }
  }
}

async function deliverPDF(st, filename, title) {
  st.footer();
  const blob = st.doc.output("blob");
  const file = new File([blob], filename, { type: "application/pdf" });
  const touch = matchMedia("(pointer: coarse)").matches;
  if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return; }
    catch (e) {
      if (e && e.name === "AbortError") return;           // user closed the share sheet
      // Share needs a fresh tap (iOS): offer a button.
      modal(`<h3>Your PDF is ready</h3><p class="muted" style="margin-top:0">${esc(filename)}</p>
        <div class="row" style="justify-content:flex-start"><button class="btn primary" id="pdfShare">${ICON.share} Share / Print / Save</button><button class="btn" data-close>Close</button></div>`, (m, close) => {
        $("#pdfShare", m).onclick = async () => { try { await navigator.share({ files: [file], title }); close(); } catch (x) { if (x.name !== "AbortError") openPDF(blob, filename); } };
      });
      return;
    }
  }
  openPDF(blob, filename);
}
function openPDF(blob, filename) {
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (!w) { const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); }
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}
const safeName = s => pdfText(s).replace(/[^A-Za-z0-9 -]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "cookbook";
async function withPDF(btn, work) {
  const old = btn && btn.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = "Making PDF…"; }
  try { const J = await loadJsPDF(); await work(J); }
  catch (e) { console.warn(e); toast("Couldn't make the PDF: " + (e.message || e)); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = old; } }
}

function pdfOneRecipe(r, k, btn) {
  return withPDF(btn, J => { const st = pdfDoc(J); pdfRecipe(st, r, k); return deliverPDF(st, safeName(r.t) + ".pdf", r.t); });
}
function pdfManyRecipes(list, title, btn) {
  const MAX = 150;
  if (list.length > MAX) toast(`Making the first ${MAX} of ${list.length} recipes`);
  return withPDF(btn, J => {
    const st = pdfDoc(J), { doc, W, M } = st, rs = list.slice(0, MAX);
    // cover
    doc.setFillColor(43, 37, 34); doc.rect(0, 0, W, st.H, "F");
    doc.setTextColor(232, 201, 160); doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("EASY KETO CARNIVORE", W / 2, 250, { align: "center" });
    doc.setTextColor(255, 255, 255); doc.setFontSize(36); doc.splitTextToSize(pdfText(title), W - 120).forEach((ln, i) => doc.text(ln, W / 2, 300 + i * 42, { align: "center" }));
    doc.setFont("helvetica", "normal"); doc.setFontSize(13); doc.setTextColor(216, 206, 196);
    doc.text(`${rs.length} recipe${rs.length === 1 ? "" : "s"}  ·  ${new Date().toLocaleDateString()}`, W / 2, 420, { align: "center" });
    // contents
    st.newPage(); st.text("Contents", 24, { bold: true }); st.y += 8;
    const tocStart = doc.getNumberOfPages(), rows = rs.map(r => r.t);
    const perPage = 38, tocPages = Math.ceil(rows.length / perPage);
    for (let p = 1; p < tocPages; p++) doc.addPage();
    // recipes, one per page
    const pageOf = [];
    rs.forEach(r => { st.newPage(); pageOf.push(doc.getNumberOfPages()); pdfRecipe(st, r, 1); });
    // fill contents now that page numbers are known
    rows.forEach((t, i) => {
      const p = tocStart + Math.floor(i / perPage), y = (p === tocStart ? 90 : M + 10) + (i % perPage) * 17;
      doc.setPage(p); doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(43, 37, 34);
      doc.text(doc.splitTextToSize(pdfText(`${i + 1}.  ${t}`), W - 2 * M - 40)[0], M, y);
      doc.text(String(pageOf[i]), W - M, y, { align: "right" });
      doc.link(M, y - 10, W - 2 * M, 14, { pageNumber: pageOf[i] });
    });
    doc.setPage(doc.getNumberOfPages());
    return deliverPDF(st, safeName(title) + ".pdf", title);
  });
}
function pdfShoppingList(btn) {
  return withPDF(btn, J => {
    const st = pdfDoc(J), { doc, M } = st;
    st.text("Shopping list", 24, { bold: true }); st.text(new Date().toLocaleDateString(), 10, { color: [110, 98, 91] }); st.y += 10;
    for (const g of GORDER) {
      const its = S.list.filter(x => x.g === g && !x.done); if (!its.length) continue;
      st.ensure(40); st.text(g.toUpperCase(), 10, { bold: true, color: [142, 44, 44] }); st.y += 4;
      for (const x of its) {
        st.ensure(18); doc.setDrawColor(150, 140, 132); doc.setLineWidth(0.9); doc.rect(M + 2, st.y + 2, 10, 10);
        st.text([qtyText(x), x.name].filter(Boolean).join(" "), 12, { x: M + 22, lh: 1.45 });
      }
      st.y += 10;
    }
    return deliverPDF(st, "Shopping-list.pdf", "Shopping list");
  });
}
function pdfMealPlan(btn, withRecipes) {
  return withPDF(btn, J => {
    const st = pdfDoc(J), { doc, W, M } = st, g = S.goals, used = [];
    st.text("Meal plan", 24, { bold: true }); st.text(`Goals per day: ${g.kcal} cal · ${g.p} g protein · ${g.f} g fat · ${g.c} g net carbs`, 10, { color: [110, 98, 91] }); st.y += 8;
    DAYS.forEach((d, di) => {
      const rows = SLOTS.map(([s, n]) => [n, planItems(di, s).map(id => byId.get(id))]).filter(x => x[1].length);
      st.ensure(30 + rows.length * 16);
      doc.setDrawColor(228, 218, 208); doc.line(M, st.y, W - M, st.y); st.y += 8;
      st.text(d, 14, { bold: true });
      if (!rows.length) { st.text("Nothing planned", 10.5, { color: [110, 98, 91] }); st.y += 4; return; }
      let t = [0, 0, 0, 0];
      for (const [n, rs] of rows) { rs.forEach(r => { t = t.map((v, j) => v + r.n[j]); if (!used.includes(r)) used.push(r); }); st.text(`${n}: ${rs.map(r => r.t).join(", ")}`, 11, { x: M + 10 }); }
      st.text(`Day total: ${Math.round(t[0])} cal · ${Math.round(t[1])} g protein · ${Math.round(t[2])} g fat · ${Math.round(t[3])} g net carbs`, 9.5, { x: M + 10, color: [110, 98, 91] });
      st.y += 6;
    });
    if (withRecipes) used.forEach(r => { st.newPage(); pdfRecipe(st, r, 1, false); });
    return deliverPDF(st, "Meal-plan.pdf", "Meal plan");
  });
}
// Warm up the PDF tool in the background so the first tap is instant.
const warmPDF = () => { if ("requestIdleCallback" in window) requestIdleCallback(() => loadJsPDF().catch(() => {})); else setTimeout(() => loadJsPDF().catch(() => {}), 1500); };

/* ---------- sync between devices (end-to-end encrypted, via the same Cloudflare server) ----------
   The sync code never leaves the device. From it we derive:
     id   = SHA-256 hash  -> names the locker on the server
     aes  = AES-GCM key   -> encrypts every item before upload
     mac  = HMAC key      -> turns item names ("fav:143") into opaque labels
   Each favorite / note / rating / plan slot / shopping item is its own item. Newest change wins. */
const SYNC_ON = () => !!(PUSH && S.sync && S.sync.code && S.sync.on);
const B32 = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";            // no I, L, O, 0, 1 (easy to read and type)
const normCode = c => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const fmtCode = c => normCode(c).match(/.{1,4}/g).join("-");
const validCode = c => normCode(c).length === 20 && [...normCode(c)].every(ch => B32.includes(ch));
function newCode() { const r = crypto.getRandomValues(new Uint8Array(20)); return fmtCode([...r].map(x => B32[x % 31]).join("")); }
const enc8 = new TextEncoder(), dec8 = new TextDecoder();
const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const toB64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
let syncKeyCache = null;
async function syncKeys() {
  const code = normCode(S.sync.code);
  if (syncKeyCache && syncKeyCache.code === code) return syncKeyCache;
  const id = toHex(await crypto.subtle.digest("SHA-256", enc8.encode("ekc-sync-v1|id|" + code)));
  const base = await crypto.subtle.importKey("raw", enc8.encode(code), "PBKDF2", false, ["deriveKey", "deriveBits"]);
  const aes = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: enc8.encode("ekc-sync-v1|enc"), iterations: 150000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const macBits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc8.encode("ekc-sync-v1|name"), iterations: 150000, hash: "SHA-256" }, base, 256);
  const mac = await crypto.subtle.importKey("raw", macBits, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return (syncKeyCache = { code, id, aes, mac, names: new Map() });
}
async function itemLabel(K, name) {
  if (!K.names.has(name)) K.names.set(name, toB64u((await crypto.subtle.sign("HMAC", K.mac, enc8.encode(name))).slice(0, 18)));
  return K.names.get(name);
}
async function seal(K, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, K.aes, enc8.encode(JSON.stringify(obj)));
  const out = new Uint8Array(12 + ct.byteLength); out.set(iv); out.set(new Uint8Array(ct), 12);
  return toB64u(out);
}
async function unseal(K, s) {
  const b = fromB64u(s);
  return JSON.parse(dec8.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12) }, K.aes, b.slice(12))));
}
const fnv = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

// What syncs: everything except device-only things (timers, alert setting, theme, the sync settings).
function flattenState() {
  const f = {};
  for (const [pre, obj] of [["fav", S.fav], ["status", S.status], ["notes", S.notes], ["rating", S.rating], ["made", S.made], ["eat", S.eat || {}], ["mine", S.mine || {}]])
    for (const k in obj) f[pre + ":" + k] = obj[k];
  for (const d in S.plan) for (const sl in S.plan[d]) if ((S.plan[d][sl] || []).length) f["plan:" + d + ":" + sl] = S.plan[d][sl];
  for (const it of S.list) f["list:" + it.key] = it;
  f.pantry = S.pantry; f.pantryFats = S.pantryFats; f.goals = S.goals; f.people = S.people; f.recent = S.recent;
  return f;
}
function applyFlat(f) {
  const fav = {}, status = {}, notes = {}, rating = {}, made = {}, eat = {}, mine = {}, plan = {}, list = [];
  const maps = { fav, status, notes, rating, made, eat, mine };
  for (const [n, v] of Object.entries(f)) {
    const [pre, a, b] = n.split(":");
    if (maps[pre] && a !== undefined) maps[pre][n.slice(pre.length + 1)] = v;
    else if (pre === "plan") ((plan[a] = plan[a] || {})[b] = v);
    else if (pre === "list") list.push(v);
  }
  const order = new Map(S.list.map((x, i) => [x.key, i]));
  list.sort((x, y) => (order.has(x.key) ? order.get(x.key) : 1e9) - (order.has(y.key) ? order.get(y.key) : 1e9));
  Object.assign(S, { fav, status, notes, rating, made, eat, mine, plan, list });
  loadMine();
  for (const k of ["pantry", "pantryFats", "goals", "people", "recent"]) if (k in f) S[k] = f[k];
}
let syncBusy = false, syncAgain = false, syncT = null, syncPoll = null;
window.__syncSoon = () => { if (!SYNC_ON() || syncApplying) return; clearTimeout(syncT); syncT = setTimeout(() => syncNow(), 1500); };
let syncApplying = false;
function quietSave() { syncApplying = true; try { save(); } finally { syncApplying = false; } }
async function syncNow(manual) {
  if (!SYNC_ON()) return;
  if (syncBusy) { syncAgain = true; return; }
  if (!navigator.onLine) { if (manual) toast("You're offline. Changes will sync when you're back online."); return; }
  syncBusy = true;
  try {
    const K = await syncKeys(), sy = S.sync, meta = sy.meta || (sy.meta = {}), now = Date.now();
    // 1. find local changes
    const flat = flattenState(), out = [];
    for (const [n, v] of Object.entries(flat)) { const h = fnv(JSON.stringify(v)); const m = meta[n]; if (!m || m.h !== h) meta[n] = { t: sy.fresh ? 1 : now, h, d: 1 }; }
    for (const n in meta) if (!(n in flat) && meta[n].h !== "-") meta[n] = { t: now, h: "-", d: 1 };
    sy.fresh = false;
    for (const n in meta) if (meta[n].d) out.push(n);
    // 2. send in batches, receive what other devices changed
    let since = sy.rev || 0, incoming = [], first = true;
    for (let i = 0; first || i < out.length; i += 300) {
      first = false;
      const batch = out.slice(i, i + 300);
      const items = await Promise.all(batch.map(async n => ({ k: await itemLabel(K, n), t: meta[n].t, ct: await seal(K, { n, v: meta[n].h === "-" ? null : flat[n] }) })));
      const r = await fetch(PUSH + "/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: K.id, dev: sy.dev, since, items }) });
      if (r.status === 410) { sy.on = false; quietSave(); toast("Your sync code was changed on another device. Enter the new code in Settings to keep syncing."); return; }
      if (!r.ok) throw new Error("server " + r.status);
      const res = await r.json();
      batch.forEach(n => { if (meta[n] && meta[n].d) delete meta[n].d; });
      incoming = incoming.concat(res.items || []); sy.rev = res.rev; sy.count = res.count;
      if (i + 300 >= out.length) break;
    }
    // 3. apply newer remote changes
    let changed = 0;
    if (incoming.length) {
      const cur = flattenState();
      for (const it of incoming) {
        let o; try { o = await unseal(K, it.ct); } catch (e) { continue; }
        const m = meta[o.n];
        if (m && m.t >= it.t) continue;                      // ours is the same or newer
        if (o.v === null) { delete cur[o.n]; meta[o.n] = { t: it.t, h: "-" }; }
        else { cur[o.n] = o.v; meta[o.n] = { t: it.t, h: fnv(JSON.stringify(o.v)) }; }
        changed++;
      }
      if (changed) { syncApplying = true; applyFlat(cur); syncApplying = false; }
    }
    sy.last = Date.now(); sy.err = "";
    quietSave();
    if (changed) refreshAfterSync();
    if (manual) toast(changed ? `Synced: ${changed} update${changed === 1 ? "" : "s"} from your other devices` : "Everything is in sync");
  } catch (e) {
    S.sync.err = String(e.message || e); quietSave();
    if (manual) toast("Sync didn't work: " + S.sync.err);
  } finally {
    syncBusy = false;
    if (syncAgain) { syncAgain = false; setTimeout(() => syncNow(), 300); }
    const st = document.getElementById("syncStatus"); if (st) st.innerHTML = syncStatusText();
  }
}
function refreshAfterSync() {
  counts();
  const a = document.activeElement;
  if (a && /textarea|input|select/i.test(a.tagName) && app.contains(a)) return;   // don't redraw under someone typing
  if (document.querySelector(".modal-bg,.cook")) return;
  const y = window.scrollY; route(); window.scrollTo({ top: y, behavior: "instant" });
}
function startSyncLoop() {
  clearInterval(syncPoll);
  if (!SYNC_ON()) return;
  syncNow();
  syncPoll = setInterval(() => { if (!document.hidden) syncNow(); }, 30000);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && SYNC_ON()) syncNow(); });
window.addEventListener("online", () => { if (SYNC_ON()) syncNow(); });
function syncStatusText() {
  const sy = S.sync || {};
  if (!SYNC_ON()) return "Off";
  const ago = sy.last ? Math.max(0, Math.round((Date.now() - sy.last) / 60000)) : null;
  return `${sy.mode === "passkey" ? "🔑 On with your Apple account passkey" : "🔄 On with a sync code"}${sy.last ? ` · last synced ${ago < 1 ? "just now" : ago + " min ago"}` : " · syncing…"}${sy.err ? ` · <span style="color:#c44">problem: ${esc(sy.err)}</span>` : ""}`;
}
async function syncStart(code, fresh, mode) {
  S.sync = { code: fmtCode(code), mode: mode || "code", dev: (S.sync && S.sync.dev) || toHex(crypto.getRandomValues(new Uint8Array(8))), on: true, rev: 0, meta: {}, fresh, last: 0, err: "" };
  syncKeyCache = null; save();
  toast(fresh ? "Joining… merging this device's data" : "Sync is on");
  await syncNow();
  startSyncLoop();
}
let qrLoad = null;
function loadQR() { if (window.qrcode) return Promise.resolve(window.qrcode); return qrLoad || (qrLoad = new Promise((ok, bad) => { const s = document.createElement("script"); s.src = "vendor/qrcode.js"; s.onload = () => ok(window.qrcode); s.onerror = () => { qrLoad = null; bad(new Error("QR didn't load")); }; document.head.appendChild(s); })); }
async function showSyncCode() {
  const code = S.sync.code, link = SITE_URL + "#/sync/" + normCode(code);
  let svg = "";
  try { const Q = await loadQR(); const q = Q(0, "M"); q.addData(link); q.make(); svg = q.createSvgTag({ cellSize: 5, margin: 3, scalable: true }); } catch (e) {}
  modal(`<h3>Your sync code</h3>${S.sync.mode === "passkey" ? `<p style="margin-top:0">🔑 This code comes from your passkey. Apple devices on your account don't need it; use it for a Windows PC or to share with family.</p>` : ""}
    <p class="muted" style="margin-top:0">Use it on your other devices. Anyone with this code can see and change your cookbook data, so only share it with devices you trust.</p>
    <div style="font:700 clamp(15px,5.2vw,26px) ui-monospace,Menlo,Consolas,monospace;letter-spacing:.04em;text-align:center;margin:10px 0;white-space:nowrap;user-select:all">${esc(code)}</div>
    ${svg ? `<div class="qrbox">${svg}</div><p class="muted" style="font-size:12.5px;text-align:center">Scan with the other device's camera (iPad, PC, Android). On an iPhone Home Screen app, type or paste the code instead.</p>` : ""}
    <div class="row" style="justify-content:center"><button class="btn" id="scCopy">Copy code</button>${navigator.share ? `<button class="btn" id="scShare">${ICON.share} Send to my other device</button>` : ""}<button class="btn primary" data-close>Done</button></div>
    <p class="muted" style="font-size:12.5px;margin-bottom:0">Tip: save this code in your password manager. It's the only way to unlock your synced data.</p>`, m => {
    $("#scCopy", m).onclick = async () => { try { await navigator.clipboard.writeText(code); toast("Code copied"); } catch (e) { toast(code); } };
    if ($("#scShare", m)) $("#scShare", m).onclick = () => navigator.share({ title: "Cookbook sync code", text: `My cookbook sync code: ${code}\n${link}` }).catch(() => {});
  });
}
function joinDialog(prefill) {
  modal(`<h3>Join sync</h3>
    <p class="muted" style="margin-top:0">Enter the sync code shown on your other device (Settings → Sync → Show my sync code). This device's favorites, notes and lists are combined with the synced ones.</p>
    <input class="inp" id="jCode" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" style="font:600 18px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.05em" value="${esc(prefill ? fmtCode(prefill) : "")}">
    <div class="row"><button class="btn" data-close>Cancel</button><button class="btn primary" id="jGo">Join</button></div>`, (m, close) => {
    const go = async () => {
      const c = $("#jCode", m).value;
      if (!validCode(c)) { toast("That code doesn't look right: it's 20 letters and numbers"); return; }
      close(); await syncStart(c, true);
      toast(S.sync.err ? "Couldn't reach the sync server: " + S.sync.err : "Joined! This device now syncs.");
      if (location.hash.startsWith("#/settings")) viewSettings();
    };
    $("#jGo", m).onclick = go; $("#jCode", m).onkeydown = e => { if (e.key === "Enter") go(); };
  });
}
function syncBoxHTML() {
  if (!PUSH) return `<p class="muted" style="margin:0">Sync uses your timer-alert server. Run <b>setup-push.ps1</b> once to turn it on.</p>`;
  if (!SYNC_ON()) return `<p style="margin-top:0">Keep favorites, lists, notes, ratings, meal plans and the shopping list the same on your phone, iPad and computer. Encrypted on this device before it's sent.</p>
    ${S.sync && S.sync.code ? `<p class="muted" style="font-size:13px">Sync is paused on this device.</p>` : ""}
    ${passkeyPossible() ? `<button class="btn primary" id="sPk" style="margin-bottom:8px">🔑 Sync with my Apple account</button>
    <p class="muted" style="font-size:12.5px;margin:0 0 12px">Uses a passkey in your iCloud Keychain, so your iPhone, iPad and Mac on the same Apple account sync after Face ID / Touch ID. No code to type. Needs iOS 18 / macOS 15 or newer.</p>
    <p class="muted" style="font-size:12.5px;margin:0 0 6px">Or use a sync code (works on any device, including Windows):</p>` : ""}
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ${passkeyPossible() ? "" : "primary"}" id="sNew">Turn on with a sync code</button><button class="btn" id="sJoin">Join with a code</button></div>`;
  return `<p style="margin-top:0" id="syncStatus">${syncStatusText()}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="sNow">Sync now</button><button class="btn" id="sShow">Show my sync code</button>${S.sync.mode !== "passkey" && passkeyPossible() ? `<button class="btn" id="sToPk">🔑 Switch to Apple account passkey</button>` : ""}<button class="btn" id="sChange">${S.sync.mode === "passkey" ? "Switch to a new sync code" : "Change sync code"}</button><button class="btn" id="sOff">Turn off on this device</button></div>
    <p class="muted" style="font-size:12.5px;margin-bottom:0">${S.sync.mode === "passkey" ? "Other Apple devices: Settings → Sync with my Apple account. Windows PC or family: Show my sync code. " : ""}Timers, alerts and dark mode stay per device.</p>`;
}
function bindSyncBox() {
  if ($("#sNew")) $("#sNew").onclick = async () => { await syncStart(newCode(), false); viewSettings(); if (!S.sync.err) showSyncCode(); };
  if ($("#sJoin")) $("#sJoin").onclick = () => joinDialog("");
  if ($("#sPk")) $("#sPk").onclick = passkeySync;
  if ($("#sToPk")) $("#sToPk").onclick = () => { if (confirm("Switch this sync to your Apple account passkey? If you already made a cookbook passkey, pick it; otherwise one is created. Your data is merged into it, and other devices then tap “Sync with my Apple account”.")) passkeyFirst(true); };
  if ($("#sNow")) $("#sNow").onclick = () => syncNow(true);
  if ($("#sShow")) $("#sShow").onclick = showSyncCode;
  if ($("#sOff")) $("#sOff").onclick = () => { if (confirm("Stop syncing on this device? Your data stays here; other devices keep syncing.")) { S.sync.on = false; clearInterval(syncPoll); save(); viewSettings(); } };
  if ($("#sChange")) $("#sChange").onclick = async () => {
    if (!confirm("Make a new sync code? The old code stops working. Your other devices will need the new code.")) return;
    try { const K = await syncKeys(); await fetch(PUSH + "/sync/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: K.id }) }); } catch (e) {}
    await syncStart(newCode(), false); viewSettings(); showSyncCode();
  };
}

/* ---------- passkey sync: "Sync with my Apple account" ----------
   A passkey saved in iCloud Keychain (or Google Password Manager) is available on every device signed into the
   same account. The passkey's PRF extension gives a secret that only that passkey can produce (after Face ID /
   Touch ID); we turn it into the sync code, so all devices with the passkey open the same encrypted locker.
   Needs iOS/iPadOS 18+, macOS 15+ Safari, or a recent Chrome/Edge. The sync code still works as a backup. */
const PRF_SALT = new TextEncoder().encode("ekc-sync-prf-v1/cookbook-sync-secret");
const passkeyPossible = () => !!(window.PublicKeyCredential && navigator.credentials && window.isSecureContext && PUSH);
const codeFromPRF = buf => { const b = new Uint8Array(buf); let s = ""; for (let i = 0; i < 20; i++) s += B32[b[i] % 31]; return fmtCode(s); };
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
async function passkeyGet(allowIds) {
  const a = await navigator.credentials.get({ publicKey: {
    challenge: rnd(32), rpId: location.hostname, userVerification: "required", timeout: 120000,
    allowCredentials: (allowIds || []).map(id => ({ type: "public-key", id })),
    extensions: { prf: { eval: { first: PRF_SALT } } } } });
  const r = a.getClientExtensionResults ? a.getClientExtensionResults() : {};
  const out = r.prf && r.prf.results && r.prf.results.first;
  if (!out) throw Object.assign(new Error("This device's passkeys can't do sync yet (needs iOS 18 / macOS 15 or newer)."), { code: "noprf" });
  return codeFromPRF(out);
}
async function passkeyCreate() {
  const cred = await navigator.credentials.create({ publicKey: {
    rp: { name: "Easy Keto Carnivore", id: location.hostname },
    user: { id: rnd(16), name: "Cookbook sync", displayName: "Easy Keto Carnivore (sync)" },
    challenge: rnd(32),
    pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
    authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
    timeout: 120000,
    extensions: { prf: { eval: { first: PRF_SALT } } } } });
  const ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
  if (!ext.prf || ext.prf.enabled === false) throw Object.assign(new Error("This device's passkeys can't do sync yet (needs iOS 18 / macOS 15 or newer). Use a sync code instead."), { code: "noprf" });
  if (ext.prf.results && ext.prf.results.first) return codeFromPRF(ext.prf.results.first);
  toast("One more Face ID / Touch ID to finish…");
  return passkeyGet([cred.rawId]);                       // some devices only give the secret when signing in
}
const pkErr = e => e && e.code === "noprf" ? e.message : e && e.name === "NotAllowedError" ? "Cancelled, or no passkey chosen." : e && e.name === "InvalidStateError" ? "A cookbook passkey already exists on this device. Use “Sync with my Apple account”." : "Passkey didn't work: " + ((e && e.message) || e);
// Main button: use an existing cookbook passkey; if there isn't one, offer to make it.
async function passkeySync() {
  try {
    const code = await passkeyGet();
    if (SYNC_ON() && normCode(S.sync.code) === normCode(code)) { toast("Already synced with this passkey"); return; }
    await syncStart(code, true, "passkey");
    toast(S.sync.err ? "Couldn't reach the sync server: " + S.sync.err : "Synced with your Apple account passkey 🔑");
    viewSettings();
  } catch (e) {
    if (e && e.code === "noprf") { toast(e.message); return; }
    modal(`<h3>No cookbook passkey yet?</h3>
      <p class="muted" style="margin-top:0">If this is the first device you're setting up, create a passkey. It's saved in your iCloud Keychain (or Google Password Manager), so your other devices signed into the same account can use it.</p>
      <div class="row"><button class="btn" data-close>Cancel</button><button class="btn primary" id="pkCreate">Create passkey</button></div>`, (m, close) => {
      $("#pkCreate", m).onclick = async () => { close(); await passkeyFirst(); };
    });
  }
}
async function passkeyFirst(tryExisting) {
  try {
    let code = null;
    if (tryExisting) code = await passkeyGet().catch(e => { if (e && e.code === "noprf") throw e; return null; });
    if (!code) code = await passkeyCreate();
    const old = SYNC_ON() ? await syncKeys().catch(() => null) : null;
    await syncStart(code, false, "passkey");
    if (old && old.id !== (await syncKeys()).id) fetch(PUSH + "/sync/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: old.id }) }).catch(() => {});
    toast(S.sync.err ? "Couldn't reach the sync server: " + S.sync.err : "Passkey sync is on 🔑 Your other Apple devices can now tap “Sync with my Apple account”.");
    viewSettings();
  } catch (e) { toast(pkErr(e)); }
}

/* ---------- "Add to Home Screen" picture guide for iPhone/iPad ---------- */
const iosKey = (icon, label) => `<span class="ioskey">${ICON[icon]}${label ? `<span>${label}</span>` : ""}</span>`;
function iosInstallSteps() {
  return `<ol class="iossteps">
    <li>Open this site in <b>Safari</b>.</li>
    <li>Tap the Share button ${iosKey("iosShare")} at the bottom of the screen (top right on iPad).<br><span class="muted" style="font-size:13px">Don't see it? Tap ${iosKey("iosMore")} first, then ${iosKey("iosShare", "Share")}.</span></li>
    <li>Scroll down and tap ${iosKey("iosAdd", "Add to Home Screen")}<br><span class="muted" style="font-size:13px">Not in the list? Tap <b>View More</b> at the bottom of the menu.</span></li>
    <li>Tap <b>Add</b>, then open the cookbook from its new icon.</li>
  </ol>`;
}

/* ---------- settings ---------- */
let installEvt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; });
/* ---------- safe temperatures + "Before you start" guide ---------- */
const SKIP_ING = /cooked|leftover|deli|smoked sausage|kielbasa|hot dog|frank|\bham\b|bacon|pepperoni|salami|prosciutto|jerky|rotisserie|shredded|chopped chicken|carnitas|pulled|roast beef|corned|pastrami|bresaola|capicola|mortadella|chicharr|rinds|broth|stock|bones|skin|\bfat\b|lard|schmaltz|tallow|gravy|see recipe|batch|eggs?\b|cured|confit/;
function safeTemps(r) {
  const out = new Map();
  for (const g of r.g || []) {
    const L = g.toLowerCase();
    if (SKIP_ING.test(L) && !/ground|breakfast sausage|italian sausage|chorizo|merguez/.test(L)) continue;
    if (/cooked|see recipe|quail eggs?|duck eggs?|\brub\b|seasoning|spice|powder|sauce|butter|dressing/.test(L)) continue;
    if (/duck breast/.test(L)) { out.set("duckb", "Duck breast: USDA says 165°F; many cooks serve it at 135°F"); continue; }
    if (/pork belly/.test(L)) { out.set("belly", "Pork belly: cook until tender and well rendered (at least 145°F)"); continue; }
    if (/ground (chicken|turkey)|chicken|turkey|cornish|\bhens?\b|quail|pheasant|goose|duck (legs?|wings)|whole duck|\bducks?\b(?! breast)/.test(L) && !/duck breast/.test(L)) out.set("poultry", "Chicken, turkey, and other poultry 165°F");
    else if (/ground |sausage|chorizo|merguez|meatball/.test(L)) out.set("ground", "Ground meat and sausage 160°F");
    else if (/pork|secreto|boar/.test(L) && !/belly|shoulder|butt|hock|trotter|knuckle|ribs/.test(L)) out.set("pork", "Pork chops, loin, and tenderloin 145°F, then rest 3 minutes");
    else if (/pork (belly|shoulder|butt)|brisket|chuck|short ribs?|shank|oxtail|cheeks/.test(L) && !/steak/.test(L)) out.set("slow", "Pulled or shredded: cook until fork-tender (195 to 203°F)");
    else if (/steak|ribeye|sirloin|strip|filet|tenderloin|tri-tip|picanha|roast|rack|lamb|venison|bison|elk|goat|veal|backstrap|chops?/.test(L)) out.set("whole", "Beef, lamb, and game steaks and roasts 145°F (medium-rare 130 to 135°F is your choice)");
  }
  return [...out.values()];
}
const GUIDE_TEMPS = [["Beef, lamb, and game steaks and roasts", "145°F (USDA)"], ["Medium-rare, if you choose it", "130 to 135°F"], ["Pork chops, loin, and tenderloin (rest 3 min)", "145°F"], ["Ground beef, pork, lamb, and game; sausage", "160°F"], ["Chicken, turkey, duck legs, and all ground poultry", "165°F"], ["Pulled pork, brisket, and shredded roasts", "195 to 203°F"]];
function viewGuide() {
  setTab("");
  app.innerHTML = `<div class="settings guide">
    <h1 style="margin:0">Before you start</h1>
    <p>Every recipe in this book is built on animal foods: beef, pork, poultry, lamb, game, eggs, butter, cheese, and cream. Seasonings stay simple (salt, pepper, herbs, and spices) and nearly every recipe uses 6 ingredients or fewer.</p>
    <div class="box"><h3>🌡️ Safe internal temperatures</h3>
      <table class="temps">${GUIDE_TEMPS.map(([a, b], i) => `<tr${i === 1 ? ' class="sub"' : ""}><td>${a}</td><td>${b}</td></tr>`).join("")}</table>
      <p class="muted" style="font-size:13px;margin-bottom:0">Check the thickest part with an instant-read thermometer, away from the bone.</p></div>
    <div class="box"><h3>🥚 Raw and lightly cooked eggs</h3>
      <p style="margin:0">A few recipes use raw or lightly cooked yolks (mayo, hollandaise, some desserts). Use pasteurized eggs for children, pregnant women, older adults, or anyone with a weak immune system.</p></div>
    <div class="box"><h3>🧺 Pantry staples</h3><ul>
      <li><b>Fats:</b> butter, beef tallow, lard, bacon fat, avocado oil</li>
      <li><b>Dairy:</b> heavy cream, cream cheese, sour cream, cheddar, Parmesan, mozzarella</li>
      <li><b>Eggs:</b> buy them by the dozen (or three)</li>
      <li><b>Seasonings:</b> coarse salt, black pepper, garlic powder, smoked paprika, cumin, dried herbs</li>
      <li><b>Handy extras:</b> pork rinds (for breading), bone broth, sugar-free mayo and hot sauce</li></ul></div>
    <div class="box"><h3>✅ Tips for success</h3><ul>
      <li>Read labels. Bacon, sausage, deli meat, and sauces often hide sugar and starch.</li>
      <li>Use a meat thermometer. It takes the guesswork out of steaks, chops, and chicken.</li>
      <li>Pat meat dry before searing for a better crust.</li>
      <li>Cook once, eat twice. Many recipes make great leftovers for lunch.</li>
      <li>A few recipes list optional items (like pickles or capers). Leave them out for strict carnivore.</li>
      <li>Allulose browns faster than sugar. Use medium-low heat for caramels and custards.</li>
      <li>Nutrition is an estimate per serving, calculated from USDA values for the listed ingredients. Optional items are not included.</li></ul></div>
    <p class="muted" style="font-size:13px">This cookbook is for general cooking inspiration, not medical advice. Check with your doctor before making big changes to your diet.</p>
  </div>`;
  window.scrollTo(0, 0);
}

function viewSettings() {
  setTab("");
  const g = S.goals, ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  app.innerHTML = `<div class="settings">
    <h1 style="margin:0">Settings</h1>
    <div class="box"><h3>Install on your phone</h3>
      ${standalone ? `<p>✓ Running as an installed app.</p>` : ios ? iosInstallSteps() : `<p>Add the cookbook to your home screen. It opens full screen and works with no internet.</p><button class="btn primary" id="install" ${installEvt ? "" : "disabled"}>Install app</button>${installEvt ? "" : `<p class="muted" style="font-size:13px">If the button is grayed out, use your browser menu (⋮) → <b>Install app</b> or <b>Add to Home screen</b>.</p>`}`}
      <p class="muted" style="font-size:13px" id="offline">${navigator.serviceWorker && navigator.serviceWorker.controller ? "✓ Saved for offline use." : "Offline copy will be ready after this first visit finishes loading."}</p></div>
    <div class="box"><h3>Sync between devices</h3>${syncBoxHTML()}</div>
    <div class="box"><h3>App version</h3>
      <p style="margin:0 0 10px">Version <b id="appVer">…</b></p>
      <button class="btn" id="updCheck">Check for updates</button></div>
    <div class="box"><h3>Timer alerts</h3>
      ${!PUSH ? `<p class="muted" style="margin:0">Timers alert you while the app is open. To get alerts even when it's closed, run <b>setup-push.ps1</b> once (see README).</p>`
        : S.pushOn ? `<p style="margin-top:0">🔔 On for this device. Alerts arrive on the lock screen even when the app is closed.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="pTest">Send a test alert</button><button class="btn" id="pOff">Turn off</button></div>`
        : `<p style="margin-top:0">Get timer alerts on your lock screen even when the app is closed.${isIOS ? " On iPhone, add the cookbook to your Home Screen and open it from there first." : ""}</p><button class="btn primary" id="pOn">🔔 Turn on lock-screen alerts</button>`}
    </div>
    <div class="box"><h3>Daily goals (used by the meal planner)</h3>
      <div class="goals">${[["kcal", "Calories"], ["p", "Protein (g)"], ["f", "Fat (g)"], ["c", "Net carbs (g)"]].map(([k, l]) => `<label>${l}<input class="inp" type="number" min="0" data-goal="${k}" value="${g[k]}"></label>`).join("")}</div></div>
    <div class="box"><a class="sister" href="#/guide"><span class="ic">🌡️</span><span><b>Before you start</b><br><span class="muted" style="font-size:13px">Safe cooking temperatures, raw egg safety, pantry staples, and tips.</span></span></a></div>
    <div class="box"><a class="sister" href="https://k1llah03z.github.io/FitTrack/" target="_blank" rel="noopener"><span class="ic">💪</span><span><b>FitTrack</b><br><span class="muted" style="font-size:13px">Track meals, fasting, workouts and Apple Watch data. Every recipe here shows up in its food search with nutrition, and the same Apple passkey syncs both apps.</span></span></a></div>
    <div class="box"><h3>Appearance</h3><div class="chips">${[["", "Match my device"], ["light", "Light"], ["dark", "Dark"]].map(([v, t]) => `<button class="chip ${(S.theme || "") === v ? "on" : ""}" data-th="${v}">${t}</button>`).join("")}</div></div>
    <div class="box"><h3>Backup</h3>
      <p class="muted" style="margin-top:0">Favorites, notes, ratings, plans and lists are stored in this browser only. Save a backup file to move them to another device.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="bExp">Download backup</button><label class="btn">Restore backup<input type="file" id="bImp" accept="application/json,.json" hidden></label><button class="btn" id="bReset">Erase my data</button></div>
      <p class="muted" style="font-size:13px">${Object.keys(S.fav).length} favorites · ${Object.keys(S.status).length} in want-to-try / tried lists · ${Object.keys(S.notes).length} notes · ${Object.keys(S.rating).length} ratings · ${Object.values(S.made).reduce((a, b) => a + b.length, 0)} cooks logged</p></div>
    <div class="box helpbox"><h3>Search tips</h3>${searchHelp()}</div>
  </div>`;
  swVersion(navigator.serviceWorker && navigator.serviceWorker.controller).then(v => { const el = $("#appVer"); if (el) el.textContent = v || "(older version: tap Check for updates)"; });
  $("#updCheck").onclick = () => checkForUpdate(true);
  bindSyncBox();
  if ($("#pOn")) $("#pOn").onclick = async () => { await enablePush(); viewSettings(); };
  if ($("#pOff")) $("#pOff").onclick = async () => { await disablePush(); viewSettings(); };
  if ($("#pTest")) $("#pTest").onclick = pushTest;
  $$("[data-goal]").forEach(i => i.onchange = () => { S.goals[i.dataset.goal] = Math.max(1, +i.value || 1); save(); toast("Goal saved"); });
  $$("[data-th]").forEach(b => b.onclick = () => { S.theme = b.dataset.th || null; applyTheme(); save(); viewSettings(); });
  if ($("#install")) $("#install").onclick = async () => { if (installEvt) { installEvt.prompt(); await installEvt.userChoice; installEvt = null; viewSettings(); } };
  $("#bExp").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: "application/json" })); a.download = `carnivore-cookbook-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); };
  $("#bImp").onchange = async e => { try { const d = JSON.parse(await e.target.files[0].text()); if (typeof d !== "object" || !d.fav) throw 0; S = Object.assign(DEF(), d); loadMine(); timersFromState(); syncKeyCache = null; startSyncLoop(); save(); applyTheme(); toast("Backup restored"); viewSettings(); } catch (x) { toast("That file isn't a cookbook backup"); } };
  $("#bReset").onclick = () => { if (confirm("Erase favorites, notes, ratings, plans and lists on this device?")) { clearInterval(syncPoll); S = DEF(); save(); applyTheme(); timersFromState(); viewSettings(); } };
}
function searchHelp() {
  return `<p style="margin-top:0">Search looks through every title, ingredient, step and tip.</p>
  <ul style="padding-left:18px;margin:0;line-height:1.9">
    <li><code>ribeye butter</code> recipes with both words</li>
    <li><code>"cream cheese"</code> an exact phrase</li>
    <li><code>chicken -wings</code> leave out a word</li>
    <li><code>protein&gt;40</code> <code>calories&lt;500</code> <code>carbs&lt;2</code> <code>fat&lt;30</code> <code>time&lt;=20</code> <code>serves&gt;=6</code></li>
    <li><code>air fryer</code> <code>slow cooker</code> <code>smoker</code> <code>budget</code> <code>quick</code> cooking methods and tags</li>
    <li>Press <code>/</code> anywhere to jump to search.</li></ul>`;
}
function applyTheme() {
  const t = S.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = t;
  $('meta[name="theme-color"]').content = t === "dark" ? "#1b1816" : "#8e2c2c";
}

/* ---------- routing ---------- */
let lastRoute = "";
function route() {
  const h = location.hash || "#/";
  const prevRoute = lastRoute; lastRoute = h;
  let m;
  document.querySelectorAll(".cook,.modal-bg").forEach(x => x.remove());
  if (!/^#\/r\//.test(h)) shownRecipe = null;
  if ((m = h.match(/^#\/r\/(\d+)/))) viewRecipe(+m[1]);
  else if (h.startsWith("#/add")) viewEditor(null);
  else if ((m = h.match(/^#\/edit\/(\d+)/))) viewEditor(+m[1]);
  else if (h.startsWith("#/mine") || h.startsWith("#/fav")) viewMine((h.match(/^#\/mine\/(\w+)/) || [])[1]);
  else if (h.startsWith("#/plan")) viewPlan();
  else if (h.startsWith("#/list")) viewList();
  else if (h.startsWith("#/pantry")) viewPantry();
  else if (h.startsWith("#/guide")) viewGuide();
  else if (h.startsWith("#/settings")) viewSettings();
  else if ((m = h.match(/^#\/sync\/([A-Za-z0-9-]+)/))) { const c = m[1]; history.replaceState(null, "", "#/settings"); viewSettings(); if (SYNC_ON() && normCode(S.sync.code) === normCode(c)) toast("This device already syncs with that code"); else joinDialog(c); }
  else {
    const q = (h.match(/[?&]q=([^&]*)/) || [])[1];
    if (q != null) { Q = decodeURIComponent(q); $("#q").value = Q; $("#searchWrap").classList.toggle("has", !!Q); }
    viewBrowse();
    if (prevRoute.startsWith("#/r/") && scrollMem) requestAnimationFrame(() => window.scrollTo(0, scrollMem));
  }
}
let scrollMem = 0;
window.addEventListener("scroll", () => { if (!location.hash.startsWith("#/r/")) scrollMem = window.scrollY; }, { passive: true });
window.addEventListener("hashchange", route);

/* ---------- search box ---------- */
let qT;
$("#q").addEventListener("input", e => {
  clearTimeout(qT);
  qT = setTimeout(() => {
    Q = e.target.value; $("#searchWrap").classList.toggle("has", !!Q);
    const target = "#/" + (Q ? "?q=" + encodeURIComponent(Q) : "");
    if (/^#\/(\?|$)/.test(location.hash || "#/")) { history.replaceState(null, "", target); lastRoute = target; viewBrowse(); }
    else location.hash = target;
  }, 140);
});
$("#q").addEventListener("keydown", e => { if (e.key === "Enter") { e.target.blur(); } });
$("#qClear").onclick = () => { $("#q").value = ""; $("#q").dispatchEvent(new Event("input")); $("#q").focus(); };
$("#searchHelp").onclick = () => modal(`<div class="helpbox"><h3>Search tips</h3>${searchHelp()}</div><div class="row"><button class="btn" data-close>Got it</button></div>`);
document.addEventListener("keydown", e => { if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); $("#q").focus(); } });
$("#surprise").onclick = () => { const { list } = results(); const pool = list.length ? list : R; location.hash = "#/r/" + pool[Math.floor(Math.random() * pool.length)].i; };
$("#theme").onclick = () => { S.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; applyTheme(); save(); };
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (!S.theme) applyTheme(); });

/* ---------- printable PDF link (only if the PDF is in the repo) ---------- */
fetch("Easy_Keto_Carnivore_Cookbook.pdf", { method: "HEAD" }).then(r => { if (r.ok) $("#pdfLink").innerHTML = ` · <a href="Easy_Keto_Carnivore_Cookbook.pdf" download>Download the printable PDF</a>`; }).catch(() => {});

/* ---------- offline (service worker) ---------- */
/* ---------- updates: "Update now" banner + version number ---------- */
let swReg = null, wantReload = false;
function swVersion(worker) {
  return new Promise(res => {
    if (!worker) return res(null);
    const ch = new MessageChannel(); const t = setTimeout(() => res(null), 1500);
    ch.port1.onmessage = e => { clearTimeout(t); res(e.data && e.data.version); };
    try { worker.postMessage({ type: "version" }, [ch.port2]); } catch (e) { clearTimeout(t); res(null); }
  });
}
async function showUpdate(worker) {
  if (!worker || !navigator.serviceWorker.controller) return;   // first visit: nothing to update from
  const v = await swVersion(worker);
  let bar = document.getElementById("updBar");
  if (!bar) { bar = document.createElement("div"); bar.id = "updBar"; bar.className = "updbar"; bar.setAttribute("role", "status"); document.body.appendChild(bar); }
  bar.innerHTML = `<span>✨ New version${v ? " <b>" + esc(v) + "</b>" : ""} is ready</span><button class="btn sm primary" id="updNow">Update now</button><button class="btn sm" id="updLater" aria-label="Later">Later</button>`;
  $("#updNow").onclick = () => {
    wantReload = true; $("#updNow").textContent = "Updating…"; $("#updNow").disabled = true;
    worker.postMessage({ type: "skipWaiting" });
    setTimeout(() => location.reload(), 4000);                  // safety net if the switch signal is missed
  };
  $("#updLater").onclick = () => bar.remove();                  // it will load next time the app starts
}
async function checkForUpdate(manual) {
  if (!swReg) { if (manual) toast("Updates aren't available here"); return; }
  if (swReg.waiting) return showUpdate(swReg.waiting);
  try { await swReg.update(); } catch (e) { if (manual) toast("Couldn't check: no internet?"); return; }
  const w = swReg.installing || swReg.waiting;
  if (!w) { if (manual) toast("You're on the latest version"); return; }
  if (w.state === "installed") return showUpdate(w);
  if (manual) toast("Downloading the update…");
  w.addEventListener("statechange", () => { if (w.state === "installed") showUpdate(w); });
}
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (wantReload) { wantReload = false; location.reload(); } });
  navigator.serviceWorker.register("sw.js").then(reg => {
    swReg = reg;
    if (reg.waiting) showUpdate(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w && w.addEventListener("statechange", () => { if (w.state === "installed") showUpdate(w); });
    });
    // Coming back to the app after a while? Check for a newer version.
    let lastCheck = Date.now();
    document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - lastCheck > 10 * 60 * 1000) { lastCheck = Date.now(); reg.update().catch(() => {}); } });
  }).catch(() => {});
}

applyTheme(); loadMine(); counts(); timersFromState(); route(); startSyncLoop();
})();
