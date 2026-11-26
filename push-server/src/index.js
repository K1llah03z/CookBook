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
 */

const MAX_TIMERS = 25;
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
    if (!allowed) return json({ error: "origin not allowed" }, 403);
    if (req.method !== "POST" || !["/schedule", "/cancel", "/test"].includes(url.pathname)) return json({ error: "not found" }, 404);

    let body;
    try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
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
      const payload = JSON.stringify({ title: "⏰ Timer done", body: t.label, tag: "timer-" + id.replace(/^test-.*/, "test"), id });
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
