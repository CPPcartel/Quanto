/**
 * Prize payout: the admin surface, and the guard against paying twice.
 *
 * Runs against a live server rather than the classes directly, because the
 * things worth asserting here are HTTP-level: that the admin routes fail closed
 * without a token, that a payout can be recorded exactly once, and that nothing
 * identifying leaks from the public route while the operator route still has
 * what an operator needs.
 *
 * Start a server first:
 *   ADMIN_TOKEN=test-token REQUIRE_AUTH=false PORT=2599 node dist/index.js
 *   ADMIN_TOKEN=test-token PRIZE_URL=http://localhost:2599 node scripts/test-prizes.mjs
 */
const BASE = process.env.PRIZE_URL ?? "http://localhost:2599";
const TOKEN = process.env.ADMIN_TOKEN ?? "test-token";

let fails = 0;
const check = (l, c, d = "") => {
  if (!c) fails++;
  console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};

const get = async (path, token) =>
  fetch(`${BASE}${path}`, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);

const post = async (path, body, token) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

console.log(`\n=== prizes at ${BASE} ===`);

console.log("\n[1] admin routes are shut without a token");
/**
 * The assertion that matters most on this endpoint. It serves account ages,
 * login methods and device ids — the review data for a paid competition. A
 * misconfigured secret must close the door, never open it.
 */
check("no token is refused", (await get("/admin/season/1/review")).status !== 200);
check("empty token is refused", (await get("/admin/season/1/review", "")).status !== 200);
check("wrong token is refused", (await get("/admin/season/1/review", "not-the-token")).status === 401);
check(
  "a token of the same length but wrong is refused",
  (await get("/admin/season/1/review", "x".repeat(TOKEN.length))).status === 401,
);
check("the right token is accepted", (await get("/admin/season/1/review", TOKEN)).status === 200);

console.log("\n[2] payouts need a complete instruction");
const bad = [
  {},
  { board: "season_earned" },
  { board: "season_earned", rank: 1 },
  { board: "season_earned", rank: 1, tx: "" },
  { rank: 1, tx: "0xabc" },
];
let rejected = 0;
for (const body of bad) {
  const r = await post("/admin/season/1/payout", body, TOKEN);
  if (r.status === 400) rejected++;
}
check("incomplete instructions are refused", rejected === bad.length, `${rejected}/${bad.length}`);
check(
  "an unknown result is a 404, not a silent success",
  (await post("/admin/season/1/payout", { board: "season_earned", rank: 99, tx: "0xabc" }, TOKEN))
    .status === 404,
);

console.log("\n[3] a payout is recorded exactly once");
/**
 * The guard that stops real money going out twice.
 *
 * A winner asking again is the normal case, not an attack: they did not see the
 * transfer, or they are checking. If asking twice can overwrite the record then
 * there is no proof of the first payment, and the safe-looking answer becomes
 * "pay again".
 */
const seeded = await post(
  "/admin/season/1/payout",
  { board: "season_earned", rank: 1, tx: "0xFIRST", to: "0xwinner", note: "season 1" },
  TOKEN,
);

if (seeded.status === 404) {
  console.log("  SKIP  no frozen results on this server — run after a season has closed");
} else {
  check("the first payout is accepted", seeded.status === 200, String(seeded.status));

  const second = await post(
    "/admin/season/1/payout",
    { board: "season_earned", rank: 1, tx: "0xSECOND" },
    TOKEN,
  );
  const body = await second.json();
  check("a second payout is refused", second.status === 409, String(second.status));
  check("and reports the original transaction", body.payoutTx === "0xFIRST", String(body.payoutTx));

  const results = await (await get("/season/1/results?board=season_earned")).json();
  const winner = results.results?.[0];
  check("the public result shows it as paid", winner?.paid === true, JSON.stringify(winner?.paid));
  check("with the first tx, not the second", winner?.payoutTx === "0xFIRST", String(winner?.payoutTx));
}

console.log("\n[4] the public route leaks nothing identifying");
const publicBody = await (await get("/season/1/results")).text();
check("no device ids", !publicBody.includes("device_id") && !publicBody.includes("deviceId"));
check("no email", !publicBody.includes("email"));
check("no player ids", !publicBody.includes("player_id") && !publicBody.includes("playerId"));
check("no payout address", !publicBody.includes("payout_to") && !publicBody.includes("payoutTo"));

console.log("\n[5] the operator route has what an operator needs");
const review = await (await get("/admin/season/1/review", TOKEN)).json();
check("it responds", review.ok === true, JSON.stringify(review).slice(0, 80));
if (review.entrants?.length) {
  const e = review.entrants[0];
  check("device id is present for the operator", "deviceId" in e);
  check("account age is present", "accountAgeHours" in e);
  check("earnings are broken down by kind", typeof e.earningsByKind === "object");
  check("score per hour is computed", "scorePerHour" in e);
} else {
  console.log("  SKIP  no entrants to review yet");
}

console.log(fails === 0 ? "\nALL PRIZE CHECKS PASSED\n" : `\n${fails} FAILED\n`);
process.exit(fails === 0 ? 0 : 1);
