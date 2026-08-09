#!/usr/bin/env node
// Builds data/logos.json from two upstream icon sets, so the site ships real
// project marks without making a single external request at runtime.
//
//   npm install simple-icons@16
//   node tools/fetch-logos.mjs [--report]
//
// Sources, in priority order:
//   1. simple-icons (CC0-1.0)  - monochrome 24x24 path + the official brand hex.
//      Preferred: one path, tiny, and it tints cleanly to either theme.
//   2. homarr-labs/dashboard-icons (Apache-2.0) - full-colour marks, and the
//      only practical source for self-hosted service logos.
//
// The icons are trademarks of their respective owners; both projects ship them
// for identification purposes and so does this. A catalog entry can set
// "icon": false to opt out, or "icon": "<slug>" to pin a specific one.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DASH = "https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/svg";

// A handful of upstream marks are enormously detailed (one is 89 kB on its
// own). Past this size the download costs more than the logo is worth, so the
// entry falls back to its category glyph.
const MAX_ICON_BYTES = 20000;

let simpleIcons;
for (const path of ["simple-icons", "/tmp/node_modules/simple-icons/index.mjs", "./node_modules/simple-icons/index.mjs"]) {
  try { simpleIcons = await import(path); break; } catch { /* try the next */ }
}
if (!simpleIcons) {
  console.error("simple-icons is not installed. Run: npm install simple-icons@16");
  process.exit(1);
}

const bySlug = new Map();
for (const key of Object.keys(simpleIcons)) {
  const icon = simpleIcons[key];
  if (icon && typeof icon === "object" && icon.slug && icon.path) bySlug.set(icon.slug, icon);
}

function fetchDash(slug) {
  try {
    const out = execFileSync("curl", ["-sfL", "-m", "25", `${DASH}/${slug}.svg`],
      { encoding: "utf8", maxBuffer: 8e6 });
    return out.includes("<svg") ? out : null;
  } catch { return null; }
}

/**
 * Inline SVGs share one document, so ids inside gradients and clip paths would
 * collide. Namespace them, and drop anything scriptable.
 */
function sanitize(svg, slug) {
  let s = svg
    .replace(/<\?xml[^>]*\?>/g, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "");

  const viewBox = (s.match(/viewBox\s*=\s*"([^"]+)"/i) || [])[1] || "0 0 24 24";
  const inner = s.replace(/^[\s\S]*?<svg[^>]*>/i, "").replace(/<\/svg>\s*$/i, "").trim();

  const prefix = `bl-${slug.replace(/[^a-z0-9]+/gi, "")}-`;
  const ids = new Set();
  for (const m of inner.matchAll(/\sid\s*=\s*"([^"]+)"/g)) ids.add(m[1]);
  let out = inner;
  for (const id of ids) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out
      .replace(new RegExp(`(\\sid\\s*=\\s*")${esc}(")`, "g"), `$1${prefix}${id}$2`)
      .replace(new RegExp(`url\\(#${esc}\\)`, "g"), `url(#${prefix}${id})`)
      .replace(new RegExp(`(xlink:href\\s*=\\s*")#${esc}(")`, "g"), `$1#${prefix}${id}$2`)
      .replace(new RegExp(`(\\shref\\s*=\\s*")#${esc}(")`, "g"), `$1#${prefix}${id}$2`);
  }
  return { viewBox, inner: out.replace(/\s+/g, " ").trim() };
}

/** Candidate slugs for an entry, most specific first. */
function candidates(item) {
  if (item.icon === false) return [];
  if (typeof item.icon === "string") return [item.icon];
  const out = new Set();
  const push = (s) => {
    if (!s) return;
    const clean = String(s).toLowerCase()
      .replace(/^.*\./, "")            // kdePackages.okular -> okular
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (clean) out.add(clean);
  };
  push(item.id);
  push(item.attr);
  push(item.name);
  // Common shapes: strip a trailing -srv marker, and squash hyphens, since
  // simple-icons slugs have no separators at all.
  for (const c of [...out]) {
    out.add(c.replace(/-srv$/, ""));
    out.add(c.replace(/-/g, ""));
  }
  return [...out];
}

const read = (f) => JSON.parse(readFileSync(join(ROOT, "data", f), "utf8"));
const packages = read("packages.json");
const services = read("services.json");
const desktops = read("desktops.json");
const flakes = read("flakes.json");

const entries = [
  ...packages.items.map((x) => ({ ...x, _kind: "package" })),
  ...services.items.map((x) => ({ ...x, _kind: "service" })),
  ...desktops.items.map((x) => ({ ...x, _kind: "desktop" })),
  ...flakes.items.map((x) => ({ ...x, _kind: "flake" })),
];

const logos = {};
const cache = existsSync(join(ROOT, "data", "logos.json"))
  ? JSON.parse(readFileSync(join(ROOT, "data", "logos.json"), "utf8"))
  : {};

const matched = [];
const missed = [];
const oversized = [];

for (const item of entries) {
  const key = item.id;
  if (item.icon === false) { missed.push(`${item._kind}:${key} (opted out)`); continue; }

  // Reuse whatever a previous run resolved, so re-running is cheap.
  if (cache[key] && !process.argv.includes("--refresh")) {
    logos[key] = cache[key];
    matched.push(`${key} <- ${cache[key].src}:${cache[key].slug} (cached)`);
    continue;
  }

  let hit = null;
  for (const slug of candidates(item)) {
    const si = bySlug.get(slug);
    if (si) { hit = { src: "simple-icons", slug, mono: si.path, hex: `#${si.hex}` }; break; }
  }
  if (!hit) {
    for (const slug of candidates(item)) {
      const svg = fetchDash(slug);
      if (svg) {
        const { viewBox, inner } = sanitize(svg, slug);
        if (inner.length > MAX_ICON_BYTES) {
          oversized.push(`${key} (${slug}, ${(inner.length / 1024).toFixed(0)} kB)`);
          break;
        }
        hit = { src: "dashboard-icons", slug, viewBox, svg: inner };
        break;
      }
    }
  }

  if (hit) { logos[key] = hit; matched.push(`${key} <- ${hit.src}:${hit.slug}`); }
  else missed.push(`${item._kind}:${key}`);
}

writeFileSync(join(ROOT, "data", "logos.json"),
  JSON.stringify({
    $comment: "Generated by tools/fetch-logos.mjs. simple-icons is CC0-1.0; " +
      "dashboard-icons is Apache-2.0. The marks themselves are trademarks of " +
      "their owners and are used here only to identify the software.",
    icons: logos,
  }, null, 0) + "\n");

const bytes = readFileSync(join(ROOT, "data", "logos.json")).length;
console.log(`matched ${matched.length}/${entries.length}, ${(bytes / 1024).toFixed(0)} kB`);
const si = Object.values(logos).filter((l) => l.src === "simple-icons").length;
console.log(`  simple-icons ${si}, dashboard-icons ${Object.keys(logos).length - si}`);
if (oversized.length) console.log(`  skipped as too large: ${oversized.join(", ")}`);
if (process.argv.includes("--report")) {
  console.log(`\nno logo (${missed.length}):`);
  for (const m of missed) console.log(`  ${m}`);
}
