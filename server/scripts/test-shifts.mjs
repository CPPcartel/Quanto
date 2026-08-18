/**
 * Shift cooldown.
 *
 * The bug this guards against: cooldowns were keyed by sessionId, which a page
 * reload replaces. Reloading reset every cooldown in the city, so the 30-minute
 * limit on shift income — the only thing rate-limiting it — was decorative.
 */
import { ShiftService, SHIFT_ROUNDS, SHIFT_SWEEP_SEC } from "../dist/game/shifts.js";
import { CityState, Player, Ticker } from "../dist/rooms/schema/CityState.js";
import { CHARGE_MAX } from "../dist/game/economy.js";

let fails = 0;
const check = (l, c, d = "") => { if (!c) fails++; console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? `  — ${d}` : ""}`); };

function world() {
  const state = new CityState();
  const t = new Ticker();
  t.symbol = "NVDA"; t.x = 0; t.z = 0; t.height = 30; t.volatility = 0.001;
  state.tickers.set("NVDA", t);
  return state;
}
function player() {
  const p = new Player();
  p.charge = CHARGE_MAX; p.x = 0; p.z = 0;
  return p;
}

const state = world();
const svc = new ShiftService();
const DEVICE = "device-abc";

console.log("\n[1] a shift can be started and finished");
const p1 = player();
const start = svc.start(state, p1, "session-1", DEVICE, "NVDA");
check("shift started", start.ok, JSON.stringify(start));
check("CHARGE was spent up front", p1.charge < CHARGE_MAX, `${p1.charge}`);

// Wait past the plausibility floor, then finish.
await new Promise((r) => setTimeout(r, SHIFT_ROUNDS * SHIFT_SWEEP_SEC * 250 + 60));
const fin = svc.finish(state, p1, "session-1", start.spec.shiftId, [800, 1600, 2400]);
check("shift finished", fin.ok, JSON.stringify(fin));
check("it paid something", fin.ok && fin.paid > 0, fin.ok ? `${fin.paid} $BLOCK` : "");

console.log("\n[2] the cooldown blocks an immediate repeat");
const again = svc.start(state, player(), "session-1", DEVICE, "NVDA");
check("same session is blocked", !again.ok, again.reason);

console.log("\n[3] THE BUG: a new session must NOT reset the cooldown");
// This is exactly what a browser reload produces — same device, new sessionId.
const reloaded = svc.start(state, player(), "session-2-after-reload", DEVICE, "NVDA");
check("reloading the page does not bypass it", !reloaded.ok, reloaded.reason);

const thirdSession = svc.start(state, player(), "session-3", DEVICE, "NVDA");
check("nor does a third session", !thirdSession.ok, thirdSession.reason);

console.log("\n[4] a genuinely different player is unaffected");
const other = svc.start(state, player(), "session-other", "device-xyz", "NVDA");
check("another device can work this tower", other.ok, JSON.stringify(other));

console.log("\n[5] the cooldown is per tower, not global");
const t2 = new Ticker();
t2.symbol = "AAPL"; t2.x = 0; t2.z = 0; t2.height = 30; t2.volatility = 0.001;
state.tickers.set("AAPL", t2);
const elsewhere = svc.start(state, player(), "session-4", DEVICE, "AAPL");
check("the same device may work a different tower", elsewhere.ok, JSON.stringify(elsewhere));

console.log("\n[6] cooldownFor reports against the device");
check("device has time left on NVDA", svc.cooldownFor(DEVICE, "NVDA") > 0, `${Math.round(svc.cooldownFor(DEVICE, "NVDA") / 60000)}m`);
check("a different device is clear", svc.cooldownFor("device-nobody", "NVDA") === 0);

console.log("\n[7] sweep drops only lapsed entries");
svc.sweep();
check("a live cooldown survives the sweep", svc.cooldownFor(DEVICE, "NVDA") > 0);

console.log(`\n${fails === 0 ? "ALL SHIFT CHECKS PASSED" : fails + " FAILED"}\n`);
process.exit(fails ? 1 : 0);
