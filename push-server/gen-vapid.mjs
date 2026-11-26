// Makes a VAPID key pair for Web Push. Prints JSON: { publicKey, privateJwk }.
// Keep the private key secret (setup-push.ps1 stores it as a Cloudflare secret and in .vapid-keys.json, which git ignores).
const { subtle } = globalThis.crypto;
const kp = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const raw = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
const jwk = await subtle.exportKey("jwk", kp.privateKey);
const b64u = b => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
console.log(JSON.stringify({ publicKey: b64u(raw), privateJwk: JSON.stringify({ kty: "EC", crv: "P-256", d: jwk.d, x: jwk.x, y: jwk.y }) }));
