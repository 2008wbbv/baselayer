#!/usr/bin/env node
// Builds a single self-contained HTML file: every module, the stylesheet and
// the whole catalog inlined, so the builder works from a USB stick, an offline
// laptop or anywhere that will not serve a directory.
//
//   node tools/bundle.mjs [out.html]
//
// This is a tiny module bundler rather than a real one. It only needs to handle
// the import forms this project actually uses - static `import { a } from
// "./x.js"` and `import * as ns from "./x.js"` at the top of a file - so each
// module is wrapped in an IIFE that returns its exports and registered in a
// lookup table.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] || join(ROOT, "baselayer-standalone.html");

const MODULES = ["state.js", "icons.js", "generate.js", "validate.js", "nixsearch.js", "share.js", "ui.js", "app.js"];
const DATA = ["packages", "services", "desktops", "security", "hardware", "flakes", "bundles"];

const IMPORT_RE = /^import\s+(?:(\*\s+as\s+\w+)|(\{[^}]*\}))\s+from\s+["']\.\/([\w.-]+)["'];?\s*$/gm;
const SIDE_EFFECT_RE = /^import\s+["'][^"']+["'];?\s*$/gm;

function transform(name, src) {
  const deps = [];
  let body = src.replace(IMPORT_RE, (_all, star, named, file) => {
    deps.push(file);
    if (star) return `const ${star.replace(/^\*\s+as\s+/, "")} = __m[${JSON.stringify(file)}];`;
    return `const ${named} = __m[${JSON.stringify(file)}];`;
  });
  body = body.replace(SIDE_EFFECT_RE, "");

  if (/^\s*import\s/m.test(body))
    throw new Error(`${name}: an import form the bundler does not handle:\n  ` +
      body.match(/^\s*import\s.*$/m)[0]);

  const exported = [];
  body = body.replace(/^export\s+(async\s+function|function|const|let|class)\s+(\w+)/gm, (_a, kind, id) => {
    exported.push(id);
    return `${kind} ${id}`;
  });
  if (/^export\s/m.test(body))
    throw new Error(`${name}: an export form the bundler does not handle:\n  ` +
      body.match(/^export\s.*$/m)[0]);

  return { deps, body, exported };
}

// Dependency order, so a module is defined before anything that imports it.
const parsed = new Map();
for (const name of MODULES) parsed.set(name, transform(name, readFileSync(join(ROOT, "src", name), "utf8")));

const ordered = [];
const seen = new Set();
const visiting = new Set();
function visit(name) {
  if (seen.has(name)) return;
  if (visiting.has(name)) throw new Error(`import cycle at ${name}`);
  visiting.add(name);
  for (const d of parsed.get(name).deps) {
    if (!parsed.has(d)) throw new Error(`${name} imports ${d}, which is not in MODULES`);
    visit(d);
  }
  visiting.delete(name);
  seen.add(name);
  ordered.push(name);
}
for (const name of MODULES) visit(name);

const script = ordered.map((name) => {
  const { body, exported } = parsed.get(name);
  return `__m[${JSON.stringify(name)}] = (function () {\n${body}\nreturn { ${exported.join(", ")} };\n})();`;
}).join("\n\n");

const css = readFileSync(join(ROOT, "assets", "style.css"), "utf8");
const data = Object.fromEntries(DATA.map((f) => [f, JSON.parse(readFileSync(join(ROOT, "data", `${f}.json`), "utf8"))]));

const html = readFileSync(join(ROOT, "index.html"), "utf8")
  .replace('<link rel="stylesheet" href="assets/style.css">', `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="src/app.js"></script>', [
    "<script>",
    `window.__BASELAYER_DATA = ${JSON.stringify(data)};`,
    'window.__BASELAYER_INSTALLER = "https://YOUR-SITE.neocities.org/get.txt";',
    "const __m = {};",
    script,
    "</script>",
  ].join("\n"))
  .replace("<title>baselayer - build a NixOS configuration</title>",
    "<title>baselayer - build a NixOS configuration (standalone)</title>");

writeFileSync(OUT, html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`wrote ${OUT} (${kb} kB, ${ordered.length} modules, ${DATA.length} data files)`);
console.log(`module order: ${ordered.join(" -> ")}`);
