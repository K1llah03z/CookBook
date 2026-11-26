/**
 * Carnivore Cookbook timer alerts — Cloudflare Worker + Durable Object.
 *
 * The cookbook site (GitHub Pages) calls this when a timer starts, pauses or stops.
 * One Durable Object per phone keeps that phone's timers and sets an alarm for the next one.
 * When the alarm fires it sends a standard Web Push (VAPID + aes128gcm, RFC 8291/8292),
 * so the alert arrives even when the app is closed.
 *
 * Endpoints (JSON, CORS limited to ALLOWED_ORIGINS):
 *   GET  /vapid                         -> { publicKey }
 *   POST /schedule { sub, id, end, label }  add or move a timer (end = ms since epoch)
 *   POST /cancel   { sub, id }               remove a timer
 *   POST /test     { sub }                   send a test alert in ~2 seconds
 *
 * Stored per phone: the push subscription and pending timers only. Timers are deleted once sent.
 *
 * Device sync (SyncStore, one Durable Object per sync code):
 *   POST /sync        { id, dev, since, items:[{k,t,ct}] } -> { rev, items:[{k,t,ct}] }  push changes + get newer ones
 *   POST /sync/delete { id }                                  -> forget this sync space (used when the code changes)
 *   id = SHA-256 of the sync code (the code itself never reaches the server).
 *   k  = opaque item name, ct = AES-GCM ciphertext made on the device. The server can't read either.
 *   Newest change (t) wins per item.
 *
 * Health inbox (FitTrack + iPhone Shortcuts), one small mailbox per phone:
 *   GET/POST /inbox/<64-hex token>?steps=..&sleep=..&weight=..&water=..   (from Shortcuts: no Origin header needed)
 *   POST     /inbox/take { token }  -> { items:[{at,steps,sleep,weight,water}] }  and empties the mailbox (app only)
 *   Only those four numbers are kept, for at most 14 days or until the app picks them up.
 *
 * Timers may carry an optional title (FitTrack fasting alerts); default is "⏰ Timer done".
 */

const MAX_TIMERS = 25;
const SYNC_MAX_ITEMS = 20000, SYNC_MAX_CT = 100000, SYNC_MAX_BATCH = 400;
const MAX_AHEAD_MS = 48 * 3600 * 1000;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin") || "";
    const allowed = allowedOrigin(origin, env);
    const cors = {
      "Access-Control-Allow-Origin": allowed ? origin : "null",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors } });

    if (req.method === "OPTIONS") return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    if (url.pathname === "/" || url.pathname === "/health") return json({ ok: true, service: "carnivore-timer-push" });
    if (url.pathname === "/vapid" && req.method === "GET") return json({ publicKey: env.VAPID_PUBLIC_KEY || "" });
    // Health inbox drop-off from iPhone Shortcuts (no browser, so no Origin header)
    const drop = url.pathname.match(/^\/inbox\/([0-9a-f]{64})$/);
    if (drop && (req.method === "GET" || req.method === "POST")) {
      const vals = {};
      for (const [k, v] of url.searchParams) vals[k] = v;
      if (req.method === "POST") { try { Object.assign(vals, await req.json()); } catch {} }
      const stub = env.SYNC.get(env.SYNC.idFromName("inbox:" + drop[1]));
      const res = await stub.fetch("https://do/inbox/put", { method: "POST", body: JSON.stringify(vals) });
      return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json", ...cors } });
    }
    if (!allowed) return json({ error: "origin not allowed" }, 403);
    if (req.method !== "POST" || !["/schedule", "/cancel", "/test", "/sync", "/sync/delete", "/inbox/take"].includes(url.pathname)) return json({ error: "not found" }, 404);

    let body;
    try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

    if (url.pathname === "/inbox/take") {
      if (!body || !/^[0-9a-f]{64}$/.test(String(body.token || ""))) return json({ error: "bad token" }, 400);
      const stub = env.SYNC.get(env.SYNC.idFromName("inbox:" + body.token));
      const res = await stub.fetch("https://do/inbox/take", { method: "POST", body: "{}" });
      return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json", ...cors } });
    }
    if (url.pathname.startsWith("/sync")) {
      if (!body || !/^[0-9a-f]{64}$/.test(String(body.id || ""))) return json({ error: "bad sync id" }, 400);
      const stub = env.SYNC.get(env.SYNC.idFromName(body.id));
      const res = await stub.fetch("https://do" + url.pathname, { method: "POST", body: JSON.stringify(body) });
      return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json", ...cors } });
    }
    const sub = body && body.sub;
    if (!validSub(sub)) return json({ error: "bad subscription" }, 400);

    // One Durable Object per phone (named by a hash of its push endpoint).
    const name = await sha256hex(sub.endpoint);
    const stub = env.TIMERS.get(env.TIMERS.idFromName(name));
    const res = await stub.fetch("https://do" + url.pathname, { method: "POST", body: JSON.stringify(body) });
    return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json", ...cors } });
  },
};

export class TimerStore {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  async fetch(req) {
    const path = new URL(req.url).pathname;
    const b = await req.json();
    const timers = (await this.ctx.storage.get("timers")) || {};
    await this.ctx.storage.put("sub", b.sub);                     // keep the latest subscription keys

    if (path === "/schedule") {
      const end = Number(b.end), id = String(b.id || "").slice(0, 64);
      if (!id || !Number.isFinite(end)) return this.reply({ error: "bad timer" }, 400);
      if (end > Date.now() + MAX_AHEAD_MS) return this.reply({ error: "too far ahead" }, 400);
      if (!timers[id] && Object.keys(timers).length >= MAX_TIMERS) return this.reply({ error: "too many timers" }, 429);
      timers[id] = { end: Math.max(end, Date.now() + 500), label: String(b.label || "Timer").slice(0, 120) };
      if (b.title) timers[id].title = String(b.title).slice(0, 80);
      if (b.url) timers[id].url = String(b.url).slice(0, 200);
    } else if (path === "/cancel") {
      delete timers[String(b.id || "")];
    } else if (path === "/test") {
      timers["test-" + Date.now()] = { end: Date.now() + 2000, label: "Test alert: timer alerts are working ✓" };
    }
    await this.ctx.storage.put("timers", timers);
    await this.arm(timers);
    return this.reply({ ok: true, pending: Object.keys(timers).length });
  }

  async alarm() {
    const timers = (await this.ctx.storage.get("timers")) || {};
    const sub = await this.ctx.storage.get("sub");
    const now = Date.now();
    for (const [id, t] of Object.entries(timers)) {
      if (t.end > now + 1000) continue;
      delete timers[id];
      if (!sub) continue;
      const payload = JSON.stringify({ title: t.title || "⏰ Timer done", body: t.label, tag: "timer-" + id.replace(/^test-.*/, "test"), id, url: t.url || undefined });
      const status = await sendPush(sub, payload, this.env).catch(e => { console.log("push error", String(e)); return 0; });
      if (status === 404 || status === 410) {                    // phone unsubscribed: forget everything
        await this.ctx.storage.deleteAll();
        return;
      }
    }
    await this.ctx.storage.put("timers", timers);
    await this.arm(timers);
  }

  async arm(timers) {
    const ends = Object.values(timers).map(t => t.end);
    if (ends.length) await this.ctx.storage.setAlarm(Math.min(...ends));
    else { await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll(); }
  }

  reply(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } }); }
}

export class SyncStore {
  constructor(ctx, env) { this.ctx = ctx; }
  async alarm() { const list = await this.ctx.storage.get("inbox"); if (list) await this.ctx.storage.deleteAll(); }   // unclaimed health data expires
  reply(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } }); }

  async fetch(req) {
    const path = new URL(req.url).pathname;
    const b = await req.json();
    const st = this.ctx.storage;
    if (path === "/inbox/put") {
      // lenient: Shortcuts may send "8,421", "7.5 hr" or "228.4 lb"
      const num = (v, max) => { const m = String(v ?? "").replace(/,(\d{3})(?!\d)/g, "$1").replace(",", ".").match(/\d+(\.\d+)?/); const n = m ? Number(m[0]) : NaN; return Number.isFinite(n) && n > 0 && n <= max ? Math.round(n * 100) / 100 : undefined; };
      const e = { at: Date.now(), steps: num(b.steps, 200000), sleep: num(b.sleep, 24), weight: num(b.weight, 2000), water: num(b.water, 100) };
      if (e.steps === undefined && e.sleep === undefined && e.weight === undefined && e.water === undefined) return this.reply({ error: "nothing to save: send steps, sleep, weight or water" }, 400);
      const list = ((await st.get("inbox")) || []).filter(x => x.at > Date.now() - 14 * 864e5).slice(-49);
      list.push(e);
      await st.put("inbox", list);
      await st.setAlarm(Date.now() + 14 * 864e5);
      return this.reply({ ok: true, saved: e });
    }
    if (path === "/inbox/take") {
      const list = (await st.get("inbox")) || [];
      await st.deleteAll();
      return this.reply({ items: list });
    }
    if (path === "/sync/delete") { await st.deleteAll(); await st.put("deleted", true); return this.reply({ ok: true }); }
    if (await st.get("deleted")) return this.reply({ gone: true }, 410);

    let rev = (await st.get("rev")) || 0;
    let count = (await st.get("count")) || 0;
    const dev = String(b.dev || "").slice(0, 40);
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, SYNC_MAX_BATCH)
      .filter(i => i && /^[A-Za-z0-9_-]{8,64}$/.test(String(i.k)) && Number.isFinite(i.t) && typeof i.ct === "string" && i.ct.length <= SYNC_MAX_CT);
    if (items.length) {
      const existing = new Map();
      for (let i = 0; i < items.length; i += 128) {
        const got = await st.get(items.slice(i, i + 128).map(x => "i:" + x.k));
        for (const [k, v] of got) existing.set(k, v);
      }
      const puts = {};
      for (const it of items) {
        const key = "i:" + it.k, cur = puts[key] || existing.get(key);
        if (cur && cur.t > it.t) continue;                       // a newer change is already stored
        if (!cur) { if (count >= SYNC_MAX_ITEMS) return this.reply({ error: "sync space is full" }, 413); count++; }
        puts[key] = { t: it.t, ct: it.ct, rev: ++rev, by: dev };
      }
      const entries = Object.entries(puts);
      for (let i = 0; i < entries.length; i += 120) await st.put(Object.fromEntries(entries.slice(i, i + 120)));
      await st.put({ rev, count });
    }
    // Everything changed since the caller last synced (the device ignores its own echoes).
    const since = Number(b.since) || 0, out = [];
    if (since < rev) {
      const all = await st.list({ prefix: "i:" });
      for (const [k, v] of all) if (v.rev > since) out.push({ k: k.slice(2), t: v.t, ct: v.ct });
    }
    return this.reply({ rev, items: out, count });
  }
}

/* ---------------- helpers ---------------- */

function allowedOrigin(origin, env) {
  const list = String(env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim().replace(/\/$/, "")).filter(Boolean);
  if (!origin) return false;
  if (list.includes("*")) return true;
  return list.includes(origin.replace(/\/$/, ""));
}

function validSub(s) {
  try {
    if (!s || typeof s.endpoint !== "string" || !s.keys || !s.keys.p256dh || !s.keys.auth) return false;
    const u = new URL(s.endpoint);
    return u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch { return false; }
}

const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const concat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };
async function sha256hex(s) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map(b => b.toString(16).padStart(2, "0")).join(""); }
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

/** VAPID (RFC 8292): ES256 JWT signed with the server's private key. */
async function vapidAuth(endpoint, env) {
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", d: jwk.d, x: jwk.x, y: jwk.y, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || "mailto:timers@example.com" })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(header + "." + claims));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

/** Message encryption (RFC 8291, aes128gcm). */
async function encrypt(sub, plaintext) {
  const uaPublic = unb64u(sub.keys.p256dh), authSecret = unb64u(sub.keys.auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const prkKey = await hmac(authSecret, ecdh);
  const ikm = await hmac(prkKey, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(enc.encode(plaintext), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);                      // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

async function sendPush(sub, payload, env) {
  const body = await encrypt(sub, payload);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuth(sub.endpoint, env),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "3600",
      Urgency: "high",
    },
    body,
  });
  console.log("push", res.status);
  return res.status;
}
