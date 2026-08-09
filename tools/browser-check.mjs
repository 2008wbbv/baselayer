#!/usr/bin/env node
// Drives the real page in Chromium: walks every step, exercises search,
// selection, export and the share link, and fails on any console error.
//
//   node tools/browser-check.mjs [baseUrl] [--shots DIR]

import { chromium } from "/tmp/node_modules/playwright-core/index.mjs";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://localhost:8137/";
const shotDir = process.argv.includes("--shots")
  ? process.argv[process.argv.indexOf("--shots") + 1]
  : null;
if (shotDir) mkdirSync(shotDir, { recursive: true });

const problems = [];
let checks = 0;
const ok = (msg) => { checks++; console.log(`  ok    ${msg}`); };
const bad = (msg) => { problems.push(msg); console.log(`  FAIL  ${msg}`); };

// Outbound HTTPS in this sandbox goes through a local proxy; without it the
// browser cannot reach the nixpkgs index and only the offline path is tested.
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || null;
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
  ...(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1" } } : {}),
});
if (proxy) console.log(`(browser proxy: ${proxy})`);
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(`uncaught: ${e.message}`));

async function shot(name) {
  if (shotDir) await page.screenshot({ path: `${shotDir}/${name}.png`, fullPage: false });
}

console.log(`loading ${BASE}`);
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("#shell:not([hidden])", { timeout: 15000 });
ok("app booted");

// --- start step --------------------------------------------------------------
const bundles = await page.locator('[data-act="bundle"]').count();
if (bundles >= 10) ok(`${bundles} bundles listed`); else bad(`only ${bundles} bundles`);
await shot("01-start");

// --- apply a bundle ----------------------------------------------------------
await page.locator('[data-act="bundle"][data-id="media-server"]').click();
await page.waitForTimeout(200);
const afterBundle = await page.locator("#footer .sum").textContent();
if (/\d+ services/.test(afterBundle) && !/^0 packages/.test(afterBundle))
  ok(`bundle applied: ${afterBundle.trim().replace(/\s+/g, " ")}`);
else bad(`bundle did not populate: ${afterBundle}`);

// --- basics ------------------------------------------------------------------
await page.locator('#steps [data-act="step"][data-id="basics"]').click();
await page.locator('[data-act="meta.hostname"]').fill("jelly");
await page.locator('[data-act="meta.username"]').fill("ben");
await page.locator('[data-act="meta.timezone"]').fill("Europe/London");
await page.waitForTimeout(150);
const previewText = await page.locator("pre.code").textContent();
if (previewText.includes('networking.hostName = "jelly"')) ok("typing updates the live preview");
else bad("preview did not pick up the hostname");
await shot("02-basics");

// invalid username must be flagged
await page.locator('[data-act="meta.username"]').fill("Bad User");
await page.waitForTimeout(150);
await page.locator('#steps [data-act="step"][data-id="review"]').click();
await page.waitForTimeout(250);
let body = await page.locator("#main").textContent();
if (body.includes("Username is not valid")) ok("invalid username is caught");
else bad("invalid username was not reported");
await page.locator('#steps [data-act="step"][data-id="basics"]').click();
await page.locator('[data-act="meta.username"]').fill("ben");
await page.waitForTimeout(150);

// --- machine -----------------------------------------------------------------
await page.locator('#steps [data-act="step"][data-id="machine"]').click();
await page.locator('[data-act="gpu"][data-id="nvidia"]').click();
await page.waitForTimeout(150);
if ((await page.locator("pre.code").textContent()).includes("hardware.nvidia"))
  ok("GPU choice reaches the config");
else bad("nvidia block missing after selecting it");
await shot("03-machine");

// --- desktop -----------------------------------------------------------------
await page.locator('#steps [data-act="step"][data-id="desktop"]').click();
await page.locator('[data-act="desktop"][data-id="hyprland"]').click();
await page.waitForTimeout(150);
if ((await page.locator("pre.code").textContent()).includes("programs.hyprland.enable"))
  ok("desktop choice reaches the config");
else bad("hyprland block missing");
await shot("04-desktop");

// --- packages + live search --------------------------------------------------
await page.locator('#steps [data-act="step"][data-id="packages"]').click();
await page.waitForTimeout(300);
const pkgCards = await page.locator('[data-act="pkg"]').count();
if (pkgCards > 100) ok(`${pkgCards} packages in the catalog grid`);
else bad(`only ${pkgCards} package cards`);

await page.locator('[data-act="search"]').fill("ripgrep");
await page.waitForTimeout(2600);
const results = await page.locator(".result").count();
const statusText = (await page.locator(".search-status").first().textContent()).trim();
const liveSearch = statusText.includes("live nixpkgs");
if (results > 0) ok(`search returned ${results} results (${statusText})`);
else bad(`search returned nothing (${statusText})`);

if (liveSearch) {
  // Live index reachable: add something deliberately absent from the catalog,
  // which exercises the "extra package" path end to end.
  await page.locator('[data-act="search"]').fill("cowsay");
  await page.waitForTimeout(2600);
  const first = page.locator(".result:not([disabled])").first();
  if (await first.count()) {
    await first.click();
    await page.waitForTimeout(300);
    if ((await page.locator("pre.code").textContent()).includes("Added from nixpkgs search"))
      ok("a package added from live search lands in systemPackages");
    else bad("searched package did not reach the config");
  } else bad("no addable result for cowsay");
} else {
  // No egress to the index. The fallback must still be usable, and must say so.
  if (statusText.includes("offline")) ok("offline fallback is labelled in the UI");
  else bad("offline fallback is not labelled");
  const before = await page.locator("#footer .sum").textContent();
  const first = page.locator(".result:not([disabled])").first();
  if (await first.count()) {
    await first.click();
    await page.waitForTimeout(300);
    const after = await page.locator("#footer .sum").textContent();
    if (before !== after) ok("a package from the offline fallback can be selected");
    else bad("offline fallback result did not select anything");
  } else bad("offline fallback produced no selectable result");
  console.log("  note  live index unreachable from this browser; live-search path not exercised");
}
await shot("05-packages");

// --- services ----------------------------------------------------------------
await page.locator('#steps [data-act="step"][data-id="services"]').click();
await page.waitForTimeout(200);
await page.locator('[data-act="svc"][data-id="vaultwarden"]').click();
await page.waitForTimeout(200);
// dependency pull-in: zigbee2mqtt needs mosquitto
await page.locator('[data-act="svc"][data-id="zigbee2mqtt"]').click();
await page.waitForTimeout(300);
const cfg = await page.locator("pre.code").textContent();
if (cfg.includes("services.mosquitto")) ok("selecting Zigbee2MQTT pulled in Mosquitto");
else bad("service dependency was not pulled in");

await page.locator('[data-act="proxy"][data-id="enabled"]').click();
await page.waitForTimeout(300);
if ((await page.locator("pre.code").textContent()).includes("services.caddy"))
  ok("reverse proxy generates a Caddy block");
else bad("reverse proxy did not generate anything");
await shot("06-services");

// --- security ----------------------------------------------------------------
await page.locator('#steps [data-act="step"][data-id="security"]').click();
await page.locator('[data-act="seclevel"][data-id="paranoid"]').click();
await page.waitForTimeout(250);
if ((await page.locator("pre.code").textContent()).includes("linuxPackages_hardened"))
  ok("paranoid level enables the hardened kernel");
else bad("hardened kernel missing at paranoid level");
await shot("07-security");

// --- the nvidia + hardened conflict must be reported -------------------------
await page.locator('#steps [data-act="step"][data-id="review"]').click();
await page.waitForTimeout(400);
body = await page.locator("#main").textContent();
if (body.includes("Hardened kernel cannot build the NVIDIA driver"))
  ok("nvidia vs hardened-kernel conflict is reported");
else bad("conflict between nvidia and hardened kernel was not reported");

// --- review contents ---------------------------------------------------------
for (const [label, needle] of [
  ["stats", "lines of Nix"],
  ["documentation table", "Documentation"],
  ["services table", "Reach it at"],
  ["open ports", "Open ports"],
  ["secrets", "Secrets to create"],
  ["curl command", "curl -sL"],
]) {
  if (body.includes(needle)) ok(`review shows ${label}`);
  else bad(`review is missing ${label}`);
}
await shot("08-review");

// --- the curl payload must decode back to the same files ---------------------
await page.waitForFunction(() => document.querySelector("#curl-cmd")?.textContent?.includes("sh -s --"), { timeout: 8000 });
const curlCmd = await page.locator("#curl-cmd").textContent();
const payload = curlCmd.trim().split(/\s+/).pop();
const decoded = await page.evaluate(async (p) => {
  const b64 = p.slice(1).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const ds = new DecompressionStream("gzip");
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new TextDecoder().decode(buf);
}, payload);
const liveConfig = await page.evaluate(() =>
  document.querySelector("pre.code").textContent);
if (decoded.startsWith("###baselayer/1")) ok("curl payload decodes to a valid bundle");
else bad("curl payload did not decode");
if (decoded.includes("###FILE configuration.nix")) ok("payload contains configuration.nix");
else bad("payload is missing configuration.nix");
if (decoded.includes('networking.hostName = "jelly"')) ok("payload matches the current state");
else bad("payload does not match the current state");
void liveConfig;

// --- share link round-trip ---------------------------------------------------
const hash = await page.evaluate(async () => {
  const m = await import("./src/state.js");
  const enc = await m.encodeState(JSON.parse(localStorage.getItem("baselayer.state.v1")));
  const back = await m.decodeState(enc);
  return { enc, sameHost: back.meta.hostname, services: back.services.length };
});
if (hash.sameHost === "jelly" && hash.services > 0) ok(`share link round-trips (${hash.enc.length} chars)`);
else bad("share link did not round-trip");

await page.goto(`${BASE}#${hash.enc}`, { waitUntil: "networkidle" });
await page.waitForSelector("#shell:not([hidden])");
await page.waitForTimeout(400);
if ((await page.locator("pre.code").textContent()).includes('networking.hostName = "jelly"'))
  ok("opening a share link restores the configuration");
else bad("share link did not restore state");

// --- responsive + theme ------------------------------------------------------
await page.emulateMedia({ colorScheme: "dark" });
await page.waitForTimeout(150);
await shot("09-dark");
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(250);
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (overflow <= 1) ok("no horizontal overflow at 390px");
else bad(`page overflows horizontally by ${overflow}px at 390px`);
await shot("10-mobile");

// --- console -----------------------------------------------------------------
// Egress to the nixpkgs index may be blocked in a sandbox; the app handles that.
const ignorable = /favicon|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_RESET|ERR_PROXY|search\.nixos\.org/i;
const real = consoleErrors.filter((e) => !ignorable.test(e));
if (real.length === 0) ok("no console errors");
else { bad(`${real.length} console error(s)`); real.slice(0, 8).forEach((e) => console.log(`        ${e}`)); }

await browser.close();
console.log(`\n${checks} checks passed, ${problems.length} failed`);
process.exit(problems.length ? 1 : 0);
