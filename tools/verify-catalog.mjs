#!/usr/bin/env node
// Checks every NixOS option path and package attribute used by data/*.json
// against the live search.nixos.org index, for every channel the site offers.
//
//   node tools/verify-catalog.mjs            # all channels
//   node tools/verify-catalog.mjs unstable   # one channel
//
// Node's fetch does not honour HTTPS_PROXY in this environment, so we shell out
// to curl. Submodule options are indexed as `foo.<name>.bar` or `foo.*.bar`, so
// index entries are turned into regexes before matching.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUTH = "aWVSALXpZv:X8gPHnzL52wFEekuxsfQ9cSh";
const BASE = "https://search.nixos.org/backend";
const curl = (a) => {
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      return execFileSync("curl", ["--retry", "2", "--retry-delay", "1", ...a],
        { encoding: "utf8", maxBuffer: 256e6 });
    } catch (e) {
      last = e;
      execFileSync("sleep", [String(2 ** i)]);
    }
  }
  throw last;
};

function es(index, body) {
  const tmp = `/tmp/es-${Math.random().toString(36).slice(2)}.json`;
  writeFileSync(tmp, JSON.stringify(body));
  const raw = curl(["-s", "-m", "120", "-u", AUTH, "-H", "Content-Type: application/json",
    "-X", "POST", `${BASE}/${index}/_search`, "--data-binary", `@${tmp}`]);
  const res = JSON.parse(raw);
  if (res.error) throw new Error(JSON.stringify(res.error).slice(0, 400));
  return res;
}

function channelIndexes() {
  const aliases = JSON.parse(curl(["-s", "-m", "30", "-u", AUTH, `${BASE}/_aliases`]));
  const best = new Map();
  for (const idx of Object.keys(aliases))
    for (const a of Object.keys(aliases[idx].aliases || {})) {
      const m = a.match(/^latest-(\d+)-nixos-(.+)$/);
      if (!m) continue;
      const [, gen, ch] = m;
      if (!best.has(ch) || Number(best.get(ch).gen) < Number(gen)) best.set(ch, { gen, alias: a });
    }
  return best;
}

/** Every option name in a channel, via search_after paging. */
function allOptions(index) {
  const names = [];
  let after;
  for (;;) {
    const body = {
      size: 5000, _source: ["option_name"], sort: [{ option_name: "asc" }],
      query: { bool: { filter: [{ term: { type: "option" } }] } },
    };
    if (after) body.search_after = after;
    const res = es(index, body);
    const hits = res.hits.hits;
    if (!hits.length) break;
    for (const h of hits) names.push(h._source.option_name);
    after = hits[hits.length - 1].sort;
    if (hits.length < 5000) break;
  }
  return names;
}

/** Index names may contain <name> or * for submodule instances. */
function buildMatcher(names) {
  const exact = new Set();
  const patterns = [];
  for (const n of names) {
    if (n.includes("<") || n.includes("*")) {
      const rx = "^" + n.split(".").map((seg) =>
        (seg.startsWith("<") && seg.endsWith(">")) || seg === "*"
          ? "[^.]+"
          : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      ).join("\\.") + "$";
      patterns.push(new RegExp(rx));
    } else exact.add(n);
  }
  return (path) => exact.has(path) || patterns.some((r) => r.test(path));
}

// --- extract option paths out of the emitted Nix -----------------------------
// Anything under one of these keys is freeform user data, not a declared option.
const FREEFORM = new Set([
  "settings", "config", "environment", "serverProperties", "extraConfig",
  "exports", "rules", "scrapeConfigs", "sysctl", "sysctlvalue", "loginLimits",
  "sessionVariables", "shellAliases", "extraOptions", "virtualHosts",
  "timerConfig", "defaultNetwork",
]);

// `jdk`, `nodejs` and `python3` are top-level aliases that the 25.11 index does
// not carry, though they resolve fine on that channel. Do not report them.
const PKG_ALLOW = new Set(["jdk", "nodejs", "python3"]);

/** A dotted key like `settings.server` is freeform if any segment is. */
const isFreeformKey = (key) =>
  key.split(".").some((s) => FREEFORM.has(s) || s.startsWith('"'));

function extractPaths(lines) {
  const stack = [];
  const out = [];
  let freeformAt = null;

  const emitLeaf = (key) => {
    if (freeformAt !== null) return;
    if (isFreeformKey(key)) return;
    out.push([...stack, key].join("."));
  };

  const push = (key, isList) => {
    stack.push(isList ? `${key}.*` : key);
    if (freeformAt === null && isFreeformKey(key)) freeformAt = stack.length - 1;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    if (/^\}?\]?\}?;?$/.test(line) && /[}\]]/.test(line)) {
      if (freeformAt !== null && stack.length - 1 === freeformAt) freeformAt = null;
      stack.pop();
      continue;
    }

    // single-line attrset:  key = { a = 1; b = 2; };
    let m = line.match(/^([\w.'"-]+)\s*=\s*\{(.+)\};?\s*$/);
    if (m && !m[2].includes("{")) {
      const parent = m[1];
      if (isFreeformKey(parent)) continue;
      for (const part of m[2].split(";")) {
        const im = part.trim().match(/^([\w.'"-]+)\s*=/);
        if (im) emitLeaf(`${parent}.${im[1]}`);
      }
      continue;
    }

    // block open:  key = {   |   key = [{   |   key = [
    m = line.match(/^([\w.'"-]+)\s*=\s*(\[\{|\{|\[)\s*$/);
    if (m) { push(m[1], m[2].startsWith("[")); continue; }

    // leaf:  key = value;
    m = line.match(/^([\w.'"-]+)\s*=\s*[^{[]/);
    if (m) { emitLeaf(m[1]); continue; }
  }
  return out;
}

const NAMESPACES = /^(services|programs|security|networking|boot|hardware|virtualisation|system|nix|users|environment|fonts|i18n|time|xdg|zramSwap|powerManagement|console|systemd)\b/;

// --- gather ------------------------------------------------------------------
const read = (f) => JSON.parse(readFileSync(join(ROOT, "data", f), "utf8"));
const services = read("services.json");
const packages = read("packages.json");
const security = read("security.json");
const desktops = read("desktops.json");
const hardware = read("hardware.json");

/** Collect { path -> owner } including per-channel overrides. */
function collect(channel) {
  const opts = new Map();
  const add = (lines, who) => {
    for (const p of extractPaths(lines))
      if (NAMESPACES.test(p) && !opts.has(p)) opts.set(p, who);
  };
  const pick = (item) => (item.nixByChannel && item.nixByChannel[channel]) || item.nix;

  for (const s of services.items) add(pick(s), `service:${s.id}`);
  for (const t of security.toggles) add(pick(t), `security:${t.id}`);
  for (const d of desktops.items) add(pick(d), `desktop:${d.id}`);
  for (const group of ["firmware", "gpu", "cpu", "filesystem", "swap", "profiles"])
    for (const h of hardware[group]) add(pick(h), `hardware:${group}:${h.id}`);
  for (const p of packages.items)
    if (p.module) add((p.moduleByChannel?.[channel] || p.module).split("\n"), `package:${p.id}`);

  const attrs = new Map();
  for (const p of packages.items) attrs.set(p.attr, `package:${p.id}`);
  for (const d of desktops.items)
    for (const a of d.packages || []) if (!attrs.has(a)) attrs.set(a, `desktop:${d.id}`);
  return { opts, attrs };
}

// --- run ---------------------------------------------------------------------
const wanted = process.argv[2];
const chans = [...channelIndexes()].filter(([c]) => !wanted || c === wanted).sort();
let failures = 0;

for (const [channel, { alias }] of chans) {
  const { opts, attrs } = collect(channel);
  const matches = buildMatcher(allOptions(alias));

  const attrList = [...attrs.keys()];
  const present = new Set();
  for (let i = 0; i < attrList.length; i += 400) {
    const chunk = attrList.slice(i, i + 400);
    const res = es(alias, {
      size: chunk.length * 2, _source: ["package_attr_name"],
      query: { bool: { filter: [{ term: { type: "package" } }], must: [{ terms: { package_attr_name: chunk } }] } },
    });
    for (const h of res.hits.hits) present.add(h._source.package_attr_name);
  }

  const badOpts = [...opts.keys()].filter((p) => !matches(p)).sort();
  const badPkgs = attrList.filter((a) => !present.has(a) && !PKG_ALLOW.has(a)).sort();

  console.log(`\n=== ${channel} (${alias}) ===`);
  console.log(`options ${opts.size - badOpts.length}/${opts.size}   packages ${attrList.length - badPkgs.length}/${attrList.length}`);
  for (const p of badOpts) console.log(`  MISSING OPTION   ${p.padEnd(58)} [${opts.get(p)}]`);
  for (const a of badPkgs) console.log(`  MISSING PACKAGE  ${a.padEnd(58)} [${attrs.get(a)}]`);
  failures += badOpts.length + badPkgs.length;
}

console.log(failures ? `\n${failures} problem(s)` : "\nall clean");
process.exit(failures ? 1 : 0);
