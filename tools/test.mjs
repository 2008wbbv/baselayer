#!/usr/bin/env node
// End-to-end checks on the generator.
//
//   node tools/test.mjs           # structural checks only (offline)
//   node tools/test.mjs --online  # also verify every emitted option path
//                                 # against the live nixpkgs option index
//
// The structural pass generates a large matrix of configurations and asserts
// the output is balanced, has no duplicate attribute paths, leaves no template
// placeholders behind, and that every id referenced by a bundle resolves.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generate, ownedPaths } from "../src/generate.js";
import { extractPaths, buildMatcher, NAMESPACES, SKIP } from "./nixpaths.mjs";
import { defaultState, applyBundle, CHANNELS } from "../src/state.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(readFileSync(join(ROOT, "data", f), "utf8"));
const cat = {
  packages: read("packages.json"),
  services: read("services.json"),
  desktops: read("desktops.json"),
  security: read("security.json"),
  hardware: read("hardware.json"),
  flakes: read("flakes.json"),
  bundles: read("bundles.json"),
};

let failures = 0;
let checks = 0;
const fail = (msg) => { failures++; console.log(`  FAIL  ${msg}`); };
const ok = () => { checks++; };

// --- structural assertions ---------------------------------------------------

/** Brackets must balance outside of '' strings and # comments. */
function balanced(text) {
  let depth = 0, inStr = false;
  for (const raw of text.split("\n")) {
    const quotes = (raw.match(/''/g) || []).length;
    if (!inStr) {
      const line = raw.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/#.*$/, "");
      for (const ch of line) {
        if (ch === "{" || ch === "[" || ch === "(") depth++;
        if (ch === "}" || ch === "]" || ch === ")") depth--;
        if (depth < 0) return false;
      }
    }
    if (quotes % 2 === 1) inStr = !inStr;
  }
  return depth === 0 && !inStr;
}

/** All attribute paths defined at the top level of the module body. */
function topLevelPaths(config) {
  const lines = config.split("\n");
  const start = lines.findIndex((l) => l.trim() === "{");
  const body = lines.slice(start + 1, lines.length - 1)
    .filter((l) => !l.trim().startsWith("#"))
    .map((l) => l.replace(/^ {2}/, ""));
  return ownedPaths(body);
}

function checkConfig(label, state) {
  let res;
  try {
    res = generate(state, cat);
  } catch (e) {
    fail(`${label}: generator threw: ${e.message}`);
    return null;
  }
  for (const f of res.files) {
    if (!balanced(f.content)) fail(`${label}: ${f.name} has unbalanced brackets`);
    else ok();
    const leftover = f.content.match(/%%[A-Z_]+%%/g);
    if (leftover) fail(`${label}: ${f.name} still contains ${[...new Set(leftover)].join(", ")}`);
    else ok();
  }
  const cfg = res.files.find((f) => f.name === "configuration.nix").content;
  const paths = topLevelPaths(cfg);
  const seen = new Map();
  for (const p of paths) {
    for (const q of seen.keys())
      if (p === q || p.startsWith(q + ".") || q.startsWith(p + "."))
        fail(`${label}: duplicate attribute path ${p} (clashes with ${q})`);
    seen.set(p, true);
  }
  ok();
  if (res.dropped.length)
    fail(`${label}: ${res.dropped.length} block(s) dropped: ` +
      res.dropped.map((d) => `${d.owner} -> ${d.path}`).join(", "));
  else ok();
  return { res, paths };
}

console.log("catalog integrity");
{
  const pkgIds = new Set(cat.packages.items.map((p) => p.id));
  const svcIds = new Set(cat.services.items.map((s) => s.id));
  const dtopIds = new Set(cat.desktops.items.map((d) => d.id));
  const flakeIds = new Set(cat.flakes.items.map((f) => f.id));
  const toggleIds = new Set(cat.security.toggles.map((t) => t.id));

  for (const set of [
    ["package", cat.packages.items], ["service", cat.services.items],
    ["desktop", cat.desktops.items], ["flake", cat.flakes.items],
  ]) {
    const seen = new Set();
    for (const it of set[1]) {
      if (seen.has(it.id)) fail(`duplicate ${set[0]} id: ${it.id}`);
      seen.add(it.id);
      for (const field of ["name", "desc", "home"])
        if (!it[field]) fail(`${set[0]} ${it.id} is missing ${field}`);
    }
    ok();
  }
  for (const b of cat.bundles.items) {
    for (const id of b.patch.packages || []) if (!pkgIds.has(id)) fail(`bundle ${b.id}: unknown package ${id}`);
    for (const id of b.patch.services || []) if (!svcIds.has(id)) fail(`bundle ${b.id}: unknown service ${id}`);
    for (const id of b.patch.flakes || []) if (!flakeIds.has(id)) fail(`bundle ${b.id}: unknown flake ${id}`);
    if (b.patch.desktop && !dtopIds.has(b.patch.desktop)) fail(`bundle ${b.id}: unknown desktop ${b.patch.desktop}`);
    ok();
  }
  for (const lvl of cat.security.levels)
    for (const t of lvl.toggles) if (!toggleIds.has(t)) fail(`level ${lvl.id}: unknown toggle ${t}`);
  for (const s of cat.services.items) {
    for (const need of s.needs || []) if (!svcIds.has(need)) fail(`service ${s.id}: unknown dependency ${need}`);
    for (const c of s.conflicts || []) if (!svcIds.has(c) && !toggleIds.has(c)) fail(`service ${s.id}: unknown conflict ${c}`);
  }
  ok();
}

console.log("default state");
checkConfig("default", defaultState());

console.log("every bundle");
for (const b of cat.bundles.items) checkConfig(`bundle:${b.id}`, applyBundle(b, defaultState()));

console.log("every desktop x display manager");
for (const d of cat.desktops.items)
  for (const dm of ["auto", "gdm", "sddm", "lightdm", "greetd", "none"]) {
    const s = defaultState();
    s.desktop = d.id;
    s.loginManager = dm;
    s.opts.autoLogin = dm !== "none";
    checkConfig(`desktop:${d.id}/${dm}`, s);
  }

console.log("every hardware combination");
for (const g of cat.hardware.gpu)
  for (const fs of cat.hardware.filesystem)
    for (const fw of cat.hardware.firmware) {
      const s = defaultState();
      s.gpu = g.id; s.filesystem = fs.id; s.firmware = fw.id;
      checkConfig(`hw:${g.id}/${fs.id}/${fw.id}`, s);
    }

console.log("every security level, and every toggle on at once");
for (const lvl of cat.security.levels) {
  const s = defaultState();
  s.security = lvl.id;
  checkConfig(`security:${lvl.id}`, s);
}
{
  const s = defaultState();
  s.security = "paranoid";
  for (const t of cat.security.toggles) s.toggles[t.id] = true;
  checkConfig("security:all-toggles", s);
}

console.log("every service individually, then all at once");
for (const svc of cat.services.items) {
  const s = defaultState();
  s.services = [svc.id];
  checkConfig(`service:${svc.id}`, s);
}
{
  const s = defaultState();
  s.services = cat.services.items.map((x) => x.id);
  s.proxy.enabled = true;
  s.proxy.baseDomain = "home.example.com";
  s.proxy.email = "me@example.com";
  const r = checkConfig("service:all+proxy", s);
  if (r && r.res.stats.services !== cat.services.items.length)
    fail("service count mismatch in stats");
}

console.log("every package at once, every channel, both formats");
for (const chan of CHANNELS)
  for (const format of ["flake", "classic"]) {
    const s = defaultState();
    s.meta.channel = chan.id;
    s.meta.format = format;
    s.packages = cat.packages.items.map((p) => p.id);
    s.flakes = cat.flakes.items.map((f) => f.id);
    s.extra = [{ attr: "hello", name: "hello", unfree: false }];
    const r = checkConfig(`all:${chan.id}/${format}`, s);
    if (r) {
      const names = r.res.files.map((f) => f.name);
      const wantFlake = format === "flake";
      if (names.includes("flake.nix") !== wantFlake) fail(`all:${chan.id}/${format}: flake.nix presence wrong`);
      if (wantFlake && !names.includes("home.nix")) fail(`all:${chan.id}/${format}: home.nix missing`);
    }
  }

console.log("escaping");
{
  const s = defaultState();
  s.meta.hostname = 'weird"host\\name';
  s.meta.fullName = 'A "quoted" name';
  const r = checkConfig("escaping", s);
  if (r) {
    const cfg = r.res.files.find((f) => f.name === "configuration.nix").content;
    if (!cfg.includes('networking.hostName = "weird\\"host\\\\name";'))
      fail("hostname was not escaped correctly");
    else ok();
  }
}

// --- online option verification ---------------------------------------------
if (process.argv.includes("--online")) {
  console.log("\nverifying generated option paths against the live index");
  const AUTH = "aWVSALXpZv:X8gPHnzL52wFEekuxsfQ9cSh";
  const BASE = "https://search.nixos.org/backend";
  const curl = (a) => {
    let last;
    for (let i = 0; i < 4; i++) {
      try { return execFileSync("curl", ["--retry", "2", "--retry-delay", "1", ...a], { encoding: "utf8", maxBuffer: 256e6 }); }
      catch (e) { last = e; execFileSync("sleep", [String(2 ** i)]); }
    }
    throw last;
  };
  const es = (index, body) => {
    const tmp = `/tmp/t-${Math.random().toString(36).slice(2)}.json`;
    writeFileSync(tmp, JSON.stringify(body));
    return JSON.parse(curl(["-s", "-m", "120", "-u", AUTH, "-H", "Content-Type: application/json",
      "-X", "POST", `${BASE}/${index}/_search`, "--data-binary", `@${tmp}`]));
  };
  const aliases = JSON.parse(curl(["-s", "-m", "30", "-u", AUTH, `${BASE}/_aliases`]));
  const best = new Map();
  for (const idx of Object.keys(aliases))
    for (const a of Object.keys(aliases[idx].aliases || {})) {
      const m = a.match(/^latest-(\d+)-nixos-(.+)$/);
      if (m && (!best.has(m[2]) || Number(best.get(m[2]).gen) < Number(m[1])))
        best.set(m[2], { gen: m[1], alias: a });
    }

  for (const chan of CHANNELS) {
    const entry = best.get(chan.id);
    if (!entry) { console.log(`  (no index for ${chan.id})`); continue; }
    const names = [];
    let after;
    for (;;) {
      const body = { size: 5000, _source: ["option_name"], sort: [{ option_name: "asc" }],
        query: { bool: { filter: [{ term: { type: "option" } }] } } };
      if (after) body.search_after = after;
      const res = es(entry.alias, body);
      const hits = res.hits.hits;
      if (!hits.length) break;
      for (const h of hits) names.push(h._source.option_name);
      after = hits[hits.length - 1].sort;
      if (hits.length < 5000) break;
    }
    const known = buildMatcher(names);

    // Generate a config that turns on absolutely everything for this channel.
    const s = defaultState();
    s.meta.channel = chan.id;
    s.packages = cat.packages.items.map((p) => p.id);
    s.services = cat.services.items.map((x) => x.id);
    s.flakes = cat.flakes.items.map((f) => f.id);
    s.security = "paranoid";
    for (const t of cat.security.toggles) s.toggles[t.id] = true;
    s.opts = { ...s.opts, flatpak: true, appimage: true, bluetooth: true, printing: true, autoLogin: true };
    s.net.ssh = true;

    const seen = new Set();
    for (const d of cat.desktops.items)
      for (const g of cat.hardware.gpu)
        for (const fs of cat.hardware.filesystem)
          for (const prof of cat.hardware.profiles) {
            const t = { ...s, desktop: d.id, gpu: g.id, filesystem: fs.id, profile: prof.id };
            const cfg = generate(t, cat).files.find((f) => f.name === "configuration.nix").content;
            const body = cfg.split("\n").map((l) => l.replace(/^ {2}/, ""));
            for (const p of extractPaths(body))
              if (NAMESPACES.test(p) && !SKIP.test(p)) seen.add(p);
          }
    const missing = [...seen].filter((p) => !known(p)).sort();
    if (missing.length) {
      for (const m of missing) fail(`${chan.id}: generated option does not exist: ${m}`);
    } else {
      console.log(`  ${chan.id}: all ${seen.size} generated option paths exist`);
      ok();
    }
  }
}

console.log(`\n${checks} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
