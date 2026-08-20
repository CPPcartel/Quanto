#!/usr/bin/env node
/**
 * Pre-deployment check.
 *
 *   node preflight.mjs
 *
 * Answers one question: if I push this to GitHub and wire it to Railway and
 * Vercel right now, does it work?
 *
 * Everything here runs locally and reads only this repository. It does not need
 * accounts, credentials, or a network connection — a check that needs the thing
 * you are about to set up cannot tell you whether to set it up.
 *
 * The secret checks come first and are the reason this file exists. Everything
 * else costs you an afternoon; a leaked key costs you the key.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
let fails = 0;
let warns = 0;

const pass = (m, d = "") => console.log(`  \x1b[32mOK\x1b[0m    ${m}${d ? `  — ${d}` : ""}`);
const fail = (m, d = "") => { fails++; console.log(`  \x1b[31mFAIL\x1b[0m  ${m}${d ? `  — ${d}` : ""}`); };
const warn = (m, d = "") => { warns++; console.log(`  \x1b[33mWARN\x1b[0m  ${m}${d ? `  — ${d}` : ""}`); };
const check = (cond, m, d = "") => (cond ? pass(m, d) : fail(m, d));
const head = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const sh = (cmd, cwd = root) => {
  try {
    return { ok: true, out: execSync(cmd, { cwd, stdio: "pipe", encoding: "utf8" }) };
  } catch (err) {
    return { ok: false, out: String(err?.stdout ?? "") + String(err?.stderr ?? "") };
  }
};

console.log("\n\x1b[1mQuanto — preflight\x1b[0m");

// ---------------------------------------------------------------------------
head("1. Secrets");

const envFiles = [];
(function walk(dir, depth = 0) {
  if (depth > 3) return;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, depth + 1);
    else if (entry === ".env" || (entry.startsWith(".env.") && entry !== ".env.example")) {
      envFiles.push(p.slice(root.length + 1).replace(/\\/g, "/"));
    }
  }
})(root);

const isRepo = existsSync(join(root, ".git"));
if (!isRepo) {
  warn("not a git repository yet", "run: git init");
} else {
  const tracked = sh("git ls-files");
  const trackedEnv = tracked.out
    .split("\n")
    .filter((f) => /(^|\/)\.env$/.test(f) || (/(^|\/)\.env\./.test(f) && !f.endsWith(".env.example")));
  check(trackedEnv.length === 0, "no .env file is tracked by git",
    trackedEnv.length ? trackedEnv.join(", ") : `${envFiles.length} on disk, all ignored`);

  // Anything key-shaped that made it into tracked files.
  const staged = sh('git grep -InE "0x[a-fA-F0-9]{64}" -- . ":(exclude)*.example"');
  const hits = staged.out.split("\n").filter((l) => l && !/0x0{40,}/.test(l));
  check(hits.length === 0, "no 64-hex private keys in tracked files",
    hits.length ? hits[0].slice(0, 90) : "");
}

const gi = existsSync(join(root, ".gitignore")) ? readFileSync(join(root, ".gitignore"), "utf8") : "";
check(/^\.env$/m.test(gi), ".gitignore covers .env");
check(/^!\.env\.example$/m.test(gi), ".gitignore keeps .env.example",
  "without the negation, .env.* swallows the docs");

// ---------------------------------------------------------------------------
head("2. Dependencies are reproducible");

for (const pkg of ["server", "client", "contracts"]) {
  const dir = join(root, pkg);
  if (!existsSync(dir)) continue;
  check(existsSync(join(dir, "package-lock.json")), `${pkg}/package-lock.json exists`,
    "Railway and Vercel run npm ci, which requires it");
}

// ---------------------------------------------------------------------------
head("3. Everything builds");

const serverBuild = sh("npm run build", join(root, "server"));
check(serverBuild.ok, "server builds", serverBuild.ok ? "tsc clean" : lastLine(serverBuild.out));

const clientBuild = sh("npm run build", join(root, "client"));
check(clientBuild.ok, "client builds", clientBuild.ok ? "vite ok" : lastLine(clientBuild.out));

check(existsSync(join(root, "server/dist/index.js")), "server/dist/index.js produced");
check(existsSync(join(root, "client/dist/index.html")), "client/dist/index.html produced");

// ---------------------------------------------------------------------------
head("4. Tests");

const serverTest = sh("npm test", join(root, "server"));
check(serverTest.ok && !/FAIL/.test(serverTest.out), "server suite green",
  serverTest.ok ? countPassed(serverTest.out) : lastLine(serverTest.out));

const clientTest = sh("npm test", join(root, "client"));
check(clientTest.ok && !/FAIL/.test(clientTest.out), "client suite green",
  clientTest.ok ? countPassed(clientTest.out) : lastLine(clientTest.out));

// ---------------------------------------------------------------------------
head("5. Deployment config");

check(existsSync(join(root, "client/vercel.json")), "client/vercel.json present",
  "sets the SPA rewrite — without it every route but / is a 404");
check(existsSync(join(root, "server/Dockerfile")), "server/Dockerfile present");

for (const [f, label] of [
  ["server/.env.example", "server"],
  ["client/.env.example", "client"],
  ["contracts/.env.example", "contracts"],
]) {
  check(existsSync(join(root, f)), `${label} .env.example documented`);
}

// Every process.env the server reads should appear in its example file.
const exampleSrc = existsSync(join(root, "server/.env.example"))
  ? readFileSync(join(root, "server/.env.example"), "utf8")
  : "";
const used = new Set();
(function scan(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) scan(p);
    else if (entry.endsWith(".ts")) {
      for (const m of readFileSync(p, "utf8").matchAll(/process\.env\.([A-Z0-9_]+)/g)) used.add(m[1]);
    }
  }
})(join(root, "server/src"));
const undocumented = [...used].filter((v) => !exampleSrc.includes(v) && v !== "NODE_ENV");
check(undocumented.length === 0, "every server env var is documented",
  undocumented.length ? `missing: ${undocumented.join(", ")}` : `${used.size} variables`);

// ---------------------------------------------------------------------------
head("6. The client bundle carries no secrets");

const assets = join(root, "client/dist/assets");
if (existsSync(assets)) {
  let leaked = [];
  for (const f of readdirSync(assets).filter((f) => f.endsWith(".js"))) {
    const body = readFileSync(join(assets, f), "utf8");
    for (const needle of ["PRIVY_APP_SECRET", "DATABASE_URL", "postgresql://", "DEPLOYER_KEY"]) {
      if (body.includes(needle)) leaked.push(`${needle} in ${f}`);
    }
  }
  check(leaked.length === 0, "no server secret names in the built client",
    leaked.length ? leaked.join(", ") : `${readdirSync(assets).filter((f) => f.endsWith(".js")).length} chunks scanned`);
} else {
  warn("client not built, skipping bundle scan");
}

// ---------------------------------------------------------------------------
head("7. What only you can do");

const manual = [
  ["GitHub repo created and pushed", "your account"],
  ["Supabase project + session pooler connection string", "free"],
  ["Railway project, root directory = server", "about $5/mo"],
  ["Vercel project, root directory = client", "free"],
  ["ALLOWED_ORIGIN on Railway = your Vercel URL", "2 minutes"],
  ["DEBUG_TOKEN set to something random", "leaves /debug/storm open otherwise"],
  ["Privy app (optional — guest play works without it)", "free tier"],
];
for (const [what, note] of manual) console.log(`  \x1b[36m--\x1b[0m    ${what}  \x1b[2m(${note})\x1b[0m`);

// ---------------------------------------------------------------------------
console.log(
  `\n${fails === 0 ? "\x1b[32mREADY TO PUSH\x1b[0m" : `\x1b[31m${fails} BLOCKING\x1b[0m`}` +
    `${warns ? `  \x1b[33m${warns} warning(s)\x1b[0m` : ""}\n`
);
process.exit(fails ? 1 : 0);

function lastLine(out) {
  const lines = String(out).trim().split("\n").filter(Boolean);
  return lines[lines.length - 1]?.slice(0, 100) ?? "";
}
function countPassed(out) {
  const n = (String(out).match(/PASSED|VERIFIED|SYNC|BOUNDED/g) ?? []).length;
  return `${n} suite(s)`;
}
