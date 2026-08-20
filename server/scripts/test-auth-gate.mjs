/**
 * The door must hold.
 *
 * This is the one check where a false pass is worse than a failure: a gate that
 * silently lets everyone through looks exactly like a working gate until someone
 * notices the city is full of accounts nobody signed into. So it asserts the
 * refusals explicitly, and asserts the *reason* alongside the code — a 401
 * raised because the server was misconfigured is not the same result as a 401
 * raised because a token was rejected, and only one of them means the gate works.
 *
 * Run against a server started with REQUIRE_AUTH=true and real Privy
 * credentials:
 *
 *   E2E_URL=ws://localhost:2567 node scripts/test-auth-gate.mjs
 */
import { Client } from "colyseus.js";

const URL = process.env.E2E_URL ?? "ws://localhost:2567";
let failures = 0;

const check = (label, cond, detail = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!cond) failures++;
};

/** Attempt a join and report how it was refused, rather than throwing. */
async function attempt(options) {
  const client = new Client(URL);
  try {
    const room = await client.joinOrCreate("city", options);
    await room.leave();
    return { joined: true };
  } catch (err) {
    return { joined: false, code: err?.code, message: String(err?.message ?? err) };
  }
}

console.log(`\n=== auth gate at ${URL} ===\n`);

const noToken = await attempt({ deviceId: "gate-probe-none" });
check("a join with no token is refused", !noToken.joined, `code=${noToken.code}`);
check("refused with 401, not 503", noToken.code === 401, noToken.message);

const forged = await attempt({ deviceId: "gate-probe-forged", privyToken: "not-a-real-token" });
check("a forged token is refused", !forged.joined, `code=${forged.code}`);

/**
 * A structurally valid JWT that was never signed by Privy. The unsigned-garbage
 * case above could be rejected by a shape check alone; this one can only be
 * rejected by actually verifying the signature.
 */
const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
const body = Buffer.from(
  JSON.stringify({
    sub: "did:privy:forged",
    iss: "privy.io",
    aud: process.env.PRIVY_APP_ID ?? "cmt1aj6rz02q40cl7o0pytmgd",
    exp: Math.floor(Date.now() / 1000) + 3600,
  }),
).toString("base64url");
const shaped = await attempt({
  deviceId: "gate-probe-shaped",
  privyToken: `${header}.${body}.bm90LWEtcmVhbC1zaWduYXR1cmU`,
});
check("a well-formed but unsigned JWT is refused", !shaped.joined, `code=${shaped.code}`);

/** An empty token must not read as "no token supplied, allow through". */
const empty = await attempt({ deviceId: "gate-probe-empty", privyToken: "" });
check("an empty token is refused", !empty.joined, `code=${empty.code}`);

console.log(
  failures === 0 ? "\nTHE DOOR HOLDS — every unauthenticated join was refused\n" : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
