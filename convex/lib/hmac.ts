// HMAC-SHA256 over `${timestamp}.${body}`, header format `t=<unix seconds>,v1=<hex>`.
// Same scheme in both directions (Convex -> n8n and n8n -> Convex), different secrets.
// Uses WebCrypto so it runs in the Convex V8 runtime and in Node.

const enc = new TextEncoder();
export const MAX_SKEW_SECONDS = 300;

const key = (secret: string, usage: KeyUsage) =>
  crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function signatureHeader(secret: string, body: string, now = Math.floor(Date.now() / 1000)) {
  const sig = await crypto.subtle.sign("HMAC", await key(secret, "sign"), enc.encode(`${now}.${body}`));
  return `t=${now},v1=${toHex(sig)}`;
}

export async function verifySignature(
  secret: string,
  body: string,
  header: string | null,
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const m = header?.match(/^t=(\d+),v1=([0-9a-f]{64})$/);
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(now - t) > MAX_SKEW_SECONDS) return false; // replay window
  const sig = new Uint8Array(m[2].match(/../g)!.map((h) => parseInt(h, 16)));
  // subtle.verify compares in constant time
  return crypto.subtle.verify("HMAC", await key(secret, "verify"), sig, enc.encode(`${t}.${body}`));
}
