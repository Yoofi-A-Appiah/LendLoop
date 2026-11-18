// Run: npm test. Checks the WebCrypto signer against Node's crypto (what the n8n Code nodes use).
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { signatureHeader, verifySignature } from "../convex/lib/hmac.ts";

const secret = "s3cret", body = JSON.stringify({ loanId: "abc", status: "sent" }), now = 1_800_000_000;
const header = await signatureHeader(secret, body, now);
assert.equal(header, `t=${now},v1=${createHmac("sha256", secret).update(`${now}.${body}`).digest("hex")}`);
assert.equal(await verifySignature(secret, body, header, now + 10), true);
assert.equal(await verifySignature(secret, body + " ", header, now), false, "tampered body");
assert.equal(await verifySignature("wrong", body, header, now), false, "wrong secret");
assert.equal(await verifySignature(secret, body, header, now + 301), false, "stale");
assert.equal(await verifySignature(secret, body, null, now), false, "missing header");
assert.equal(await verifySignature(secret, body, "t=1,v1=zz", now), false, "malformed");
console.log("hmac ok");
