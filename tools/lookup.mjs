#!/usr/bin/env node
// Ad-hoc lookup: node tools/lookup.mjs opt <path>... | pkg <attr>...
// Reports presence on every indexed channel so we can spot option drift.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const AUTH = "aWVSALXpZv:X8gPHnzL52wFEekuxsfQ9cSh";
const BASE = "https://search.nixos.org/backend";
const curl = (a) => execFileSync("curl", a, { encoding: "utf8", maxBuffer: 64e6 });

const aliases = JSON.parse(curl(["-s", "-m", "30", "-u", AUTH, `${BASE}/_aliases`]));
const byChannel = new Map();
for (const idx of Object.keys(aliases))
  for (const a of Object.keys(aliases[idx].aliases || {})) {
    const m = a.match(/^latest-(\d+)-nixos-(.+)$/);
    if (!m) continue;
    const [, gen, ch] = m;
    if (!byChannel.has(ch) || Number(byChannel.get(ch).gen) < Number(gen))
      byChannel.set(ch, { gen, alias: a });
  }
const channels = [...byChannel.entries()].sort();

function es(index, body) {
  const tmp = `/tmp/lk-${Math.random().toString(36).slice(2)}.json`;
  writeFileSync(tmp, JSON.stringify(body));
  return JSON.parse(curl(["-s", "-m", "60", "-u", AUTH, "-H", "Content-Type: application/json",
    "-X", "POST", `${BASE}/${index}/_search`, "--data-binary", `@${tmp}`]));
}

const mode = process.argv[2];
const names = process.argv.slice(3);
const field = mode === "opt" ? "option_name" : "package_attr_name";
const type = mode === "opt" ? "option" : "package";

const results = new Map(names.map((n) => [n, []]));
for (const [ch, { alias }] of channels) {
  const res = es(alias, {
    size: names.length * 2, _source: [field],
    query: { bool: { filter: [{ term: { type } }], must: [{ terms: { [field]: names } }] } },
  });
  const present = new Set((res.hits?.hits || []).map((h) => h._source[field]));
  for (const n of names) if (present.has(n)) results.get(n).push(ch);
}

const chNames = channels.map(([c]) => c);
console.log(`channels: ${chNames.join(", ")}\n`);
for (const n of names) {
  const on = results.get(n);
  const mark = on.length === chNames.length ? "OK  " : on.length ? "PART" : "MISS";
  console.log(`${mark}  ${n.padEnd(52)} ${on.join(", ") || "-"}`);
}
