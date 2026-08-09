// Wiring: load the catalog, hold state, dispatch events, re-render.

import {
  defaultState, applyBundle, clone, encodeState, decodeState, CHANNELS,
} from "./state.js";
import { generate } from "./generate.js";
import { validate } from "./validate.js";
import * as search from "./nixsearch.js";
import * as share from "./share.js";
import * as ui from "./ui.js";
import { svg } from "./icons.js";

const DATA_FILES = ["packages", "services", "desktops", "security", "hardware", "flakes", "bundles"];
const STORAGE_KEY = "baselayer.state.v1";

let cat = null;
let state = defaultState();
let view = {
  step: "start",
  previewFile: null,
  pkgCat: "all",
  searchQuery: "",
  searchResults: null,
  searching: false,
  searchOnline: null,
  searchReason: "",
  payload: null,
  curlCmd: "",
  pasteUrl: null,
  pasteHost: null,
  pasteError: null,
  showPreview: false,
};
let result = null;
let findings = [];
let searchAbort = null;
let payloadToken = 0;

const $ = (sel) => document.querySelector(sel);

async function loadCatalog() {
  const loaded = await Promise.all(
    DATA_FILES.map((f) =>
      fetch(`data/${f}.json`).then((r) => {
        if (!r.ok) throw new Error(`data/${f}.json returned ${r.status}`);
        return r.json();
      })),
  );
  cat = Object.fromEntries(DATA_FILES.map((f, i) => [f, loaded[i]]));
}

// ------------------------------------------------------------------ bootstrap

async function boot() {
  try {
    // The standalone single-file build inlines the catalog instead of fetching it.
    if (globalThis.__BASELAYER_DATA) cat = globalThis.__BASELAYER_DATA;
    else await loadCatalog();
  } catch (e) {

    $("#boot").innerHTML = `<div class="notice error" style="text-align:left">
      <span class="ico">${svg("shield", { size: 18 })}</span>
      <div><b>Could not load the catalog</b><p>${ui.esc(e.message)}</p>
      <div class="fix">If you opened this file directly, browsers block reading the data files from
      <code>file://</code>. Serve the folder instead: <code>python3 -m http.server</code></div></div></div>`;
    return;
  }

  const fromUrl = location.hash.slice(1);
  if (fromUrl) {
    try {
      state = await decodeState(fromUrl);
      view.step = "review";
    } catch (e) {
      toast(`Could not read that link: ${e.message}`);
      restore();
    }
  } else restore();

  $("#boot").remove();
  $("#shell").hidden = false;
  $("#footer").hidden = false;
  renderTopbar();
  recompute();
  render();
  probeSearch();

  window.addEventListener("hashchange", async () => {
    const h = location.hash.slice(1);
    if (!h || h === (await encodeState(state))) return;
    try {
      state = await decodeState(h);
      recompute();
      render();
    } catch { /* leave the current state alone */ }
  });
}

function restore() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.v === defaultState().v) state = { ...defaultState(), ...parsed };
    }
  } catch { /* corrupt or unavailable storage is not worth reporting */ }
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

// -------------------------------------------------------------------- compute

function recompute() {
  result = generate(state, cat);
  findings = validate(state, cat, result);
  persist();
  refreshPayload();
}

async function refreshPayload() {
  const token = ++payloadToken;
  view.payload = null;
  try {
    const payload = await share.buildPayload(result.files);
    if (token !== payloadToken) return;
    view.payload = payload;
    view.curlCmd = share.curlCommand(payload);
    if (view.step === "review") renderMain();
  } catch { /* the download buttons still work */ }
}

// --------------------------------------------------------------------- render

function render() {
  renderSteps();
  renderMain();
  renderPreview();
  renderFooter();
}

function renderSteps() {
  const counts = {
    packages: state.packages.length + state.extra.length,
    services: state.services.length,
    flakes: state.meta.format === "flake" ? state.flakes.length : 0,
    review: findings.filter((f) => f.level === "error").length,
    errors: findings.filter((f) => f.level === "error").length,
  };
  $("#steps").innerHTML = ui.renderSteps(state, view.step, counts);
  // On narrow screens the step list is a horizontal scroller, so keep the
  // current step visible after navigating.
  $('#steps [aria-current="true"]')?.scrollIntoView({ block: "nearest", inline: "center" });
}

function renderMain() {
  const el = $("#main");
  switch (view.step) {
    case "start": el.innerHTML = ui.stepStart(state, cat); break;
    case "basics": el.innerHTML = ui.stepBasics(state, cat); break;
    case "machine": el.innerHTML = ui.stepMachine(state, cat); break;
    case "desktop": el.innerHTML = ui.stepDesktop(state, cat); break;
    case "packages": el.innerHTML = ui.stepPackages(state, cat, view); break;
    case "services": el.innerHTML = ui.stepServices(state, cat); break;
    case "security": el.innerHTML = ui.stepSecurity(state, cat); break;
    case "flakes": el.innerHTML = ui.stepFlakes(state, cat); break;
    case "review": el.innerHTML = ui.stepReview(state, cat, result, findings, view); break;
  }
}

function renderPreview() {
  $("#preview").innerHTML = ui.renderPreview(result, view);
}

function renderTopbar() {
  $("#topbar-controls").innerHTML = `
    <button class="btn ghost sm" data-act="theme" title="Switch theme" aria-label="Switch theme">
      ${svg("flame", { size: 16 })}<span class="small">theme</span>
    </button>
    <a class="btn ghost sm" href="https://search.nixos.org/options" target="_blank" rel="noopener noreferrer" data-noact="1">
      NixOS options
    </a>`;
}

function renderFooter() {
  const st = result.stats;
  const errors = findings.filter((f) => f.level === "error").length;
  const idx = ui.STEPS.findIndex((s) => s.id === view.step);
  const prev = ui.STEPS[idx - 1];
  const next = ui.STEPS[idx + 1];
  $("#footer").innerHTML = `
    ${prev ? `<button class="btn sm" data-act="step" data-id="${prev.id}">← ${ui.esc(prev.name)}</button>` : ""}
    <span class="sum">${st.packages} packages · ${st.services} services · ${st.lines} lines${
      errors ? ` · <span style="color:var(--err)">${errors} problem${errors > 1 ? "s" : ""}</span>` : ""}</span>
    <span class="spacer"></span>
    <button class="btn sm" data-act="togglePreview">Preview</button>
    ${next
      ? `<button class="btn primary sm" data-act="step" data-id="${next.id}">${ui.esc(next.name)} →</button>`
      : `<button class="btn primary sm" data-act="download-zip">Download .zip</button>`}`;
}

const VALIDATORS = {
  hostname: /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/,
  username: /^[a-z_][a-z0-9_-]*$/,
};

/** Flag a bad value in place - re-rendering would move the cursor. */
function markValidity(el, key) {
  const rule = VALIDATORS[key];
  if (!rule) return;
  el.classList.toggle("bad", !rule.test(el.value));
}

let toastTimer = null;
function toast(msg) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  el.setAttribute("role", "status");
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2600);
}

// ---------------------------------------------------------------------- state

function update(fn, { rerender = true } = {}) {
  fn();
  state.bundle = state.bundle && !fn.keepBundle ? state.bundle : state.bundle;
  recompute();
  if (rerender) render();
}

const toggleIn = (arr, id) => {
  const i = arr.indexOf(id);
  if (i === -1) arr.push(id);
  else arr.splice(i, 1);
};

/** Turning on a service pulls in whatever it declares that it needs. */
function addServiceWithDeps(id) {
  const svc = cat.services.items.find((s) => s.id === id);
  if (!svc) return;
  if (state.services.includes(id)) {
    state.services = state.services.filter((x) => x !== id);
    return;
  }
  state.services.push(id);
  const pulled = [];
  for (const need of svc.needs || [])
    if (!state.services.includes(need)) {
      state.services.push(need);
      pulled.push(cat.services.items.find((s) => s.id === need)?.name || need);
    }
  if (pulled.length) toast(`Also enabled ${pulled.join(", ")}, which ${svc.name} needs`);
}

// --------------------------------------------------------------------- events

document.addEventListener("click", (ev) => {
  const link = ev.target.closest("[data-noact]");
  if (link) return;
  const el = ev.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id;
  if (el.tagName === "INPUT" || el.tagName === "SELECT") return;

  switch (act) {
    case "step":
      view.step = id;
      window.scrollTo({ top: 0, behavior: "instant" });
      render();
      break;

    case "theme": {
      const root = document.documentElement;
      const now = root.getAttribute("data-theme");
      const next = now === "dark" ? "light" : now === "light" ? null : "dark";
      if (next) root.setAttribute("data-theme", next);
      else root.removeAttribute("data-theme");
      try { localStorage.setItem("baselayer.theme", next || ""); } catch { /* ignore */ }
      break;
    }

    case "togglePreview":
      view.showPreview = !view.showPreview;
      $("#shell").classList.toggle("show-preview", view.showPreview);
      break;

    case "bundle": {
      const b = cat.bundles.items.find((x) => x.id === id);
      if (!b) break;
      const keep = { hostname: state.meta.hostname, username: state.meta.username,
        fullName: state.meta.fullName, timezone: state.meta.timezone, locale: state.meta.locale,
        keymap: state.meta.keymap, channel: state.meta.channel, format: state.meta.format,
        system: state.meta.system };
      update(() => {
        state = applyBundle(b, defaultState());
        state.meta = { ...state.meta, ...keep };
      });
      toast(`Applied "${b.name}" - adjust anything you like`);
      view.step = "basics";
      render();
      break;
    }

    case "reset":
      update(() => { state = defaultState(); });
      toast("Cleared");
      break;

    case "desktop": update(() => { state.desktop = id; state.loginManager = "auto"; }); break;
    case "loginManager": update(() => { state.loginManager = id; }); break;
    case "profile": update(() => { state.profile = id; }); break;
    case "gpu": update(() => { state.gpu = id; }); break;
    case "cpu": update(() => { state.cpu = id; }); break;
    case "firmware": update(() => { state.firmware = id; }); break;
    case "filesystem": update(() => { state.filesystem = id; }); break;
    case "swap": update(() => { state.swap = id; }); break;
    case "seclevel": update(() => { state.security = id; }); break;
    case "resetToggles": update(() => { state.toggles = {}; }); break;
    case "useFlake": update(() => { state.meta.format = "flake"; }); break;

    case "pkg": update(() => { toggleIn(state.packages, id); }); break;
    case "svc": update(() => { addServiceWithDeps(id); }); break;
    case "flake": update(() => { toggleIn(state.flakes, id); }); break;
    case "pkgCat": view.pkgCat = id; renderMain(); break;

    case "unextra":
      update(() => { state.extra = state.extra.filter((p) => p.attr !== id); });
      break;

    case "addfound": {
      const found = (view.searchResults || []).find((r) => r.attr === id);
      if (!found) break;
      update(() => {
        if (found.catalogId) {
          if (!state.packages.includes(found.catalogId)) state.packages.push(found.catalogId);
        } else if (!state.extra.some((p) => p.attr === found.attr)) {
          state.extra.push({
            attr: found.attr, name: found.name, desc: found.desc, home: found.home,
            license: found.license, unfree: found.unfree === true, version: found.version,
          });
        }
      });
      toast(`Added ${found.attr}`);
      break;
    }

    case "previewFile": view.previewFile = id; renderPreview(); break;

    case "copy-file": {
      const f = result.files.find((x) => x.name === id);
      if (f) share.copy(f.content).then((ok) => toast(ok ? `Copied ${id}` : "Could not copy"));
      break;
    }

    case "copy-config": {
      const f = result.files.find((x) => x.name === "configuration.nix");
      share.copy(f.content).then((ok) => toast(ok ? "Copied configuration.nix" : "Could not copy"));
      break;
    }

    case "copy-curl":
      share.copy(view.curlCmd).then((ok) => toast(ok ? "Command copied" : "Could not copy"));
      break;

    case "copy-curl-etc":
      share.copy(share.curlCommand(view.payload, { dir: "/etc/nixos" }))
        .then((ok) => toast(ok ? "Command copied" : "Could not copy"));
      break;

    case "download-zip":
      share.downloadBlob(`${state.meta.hostname}-nixos-config.zip`, share.makeZip(result.files));
      toast("Downloaded");
      break;

    case "download-one": {
      const f = result.files.find((x) => x.name === id);
      if (f) { share.downloadText(f.name, f.content); toast(`Downloaded ${f.name}`); }
      break;
    }

    case "share":
      encodeState(state).then(async (enc) => {
        const url = `${location.origin}${location.pathname}#${enc}`;
        history.replaceState(null, "", `#${enc}`);
        const ok = await share.copy(url);
        toast(ok ? "Share link copied" : url.slice(0, 60) + "…");
      });
      break;

    case "publish": {
      const host = share.PASTE_HOSTS.find((h) => h.id === id);
      if (!host) break;
      view.pasteError = null;
      view.pasteUrl = null;
      el.disabled = true;
      el.textContent = "Uploading…";
      host.upload(share.packFiles(result.files))
        .then((r) => { view.pasteUrl = r.raw || r.url; view.pasteHost = host.name; })
        .catch((e) => { view.pasteError = `${host.name}: ${e.message}. The curl command above needs no upload.`; })
        .finally(() => renderMain());
      break;
    }
  }
});

document.addEventListener("change", (ev) => {
  const el = ev.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id;

  if (act === "opt") { update(() => { state.opts[id] = el.checked; }); return; }
  if (act === "net") { update(() => { state.net[id] = el.checked; }); return; }
  if (act === "proxy") { update(() => { state.proxy[id] = el.checked; }); return; }
  if (act === "toggle") {
    update(() => { state.toggles = { ...state.toggles, [id]: el.checked }; });
    return;
  }
  if (act.startsWith("meta.") || act.startsWith("proxy.")) {
    // Text inputs are applied by the `input` handler as you type. Re-rendering
    // here as well would rebuild the form on blur and swallow the edit you were
    // part-way through making in the next field.
    if (el.tagName !== "SELECT") return;
    const [group, key] = act.split(".");
    update(() => { state[group][key] = el.value; });
    if (group === "meta" && key === "channel") { view.searchResults = null; probeSearch(); }
    return;
  }
});

// Text inputs update as you type, but only the preview and footer need to move.
document.addEventListener("input", (ev) => {
  const el = ev.target.closest("[data-act]");
  if (!el || el.type === "checkbox") return;
  const act = el.dataset.act;

  if (act === "search") { queueSearch(el.value); return; }

  if (act.startsWith("meta.") || act.startsWith("proxy.")) {
    const [group, key] = act.split(".");
    state[group][key] = el.value;
    recompute();
    renderPreview();
    renderFooter();
    renderSteps();
    markValidity(el, key);
    // Validation lives on the review step, so refresh it there as you type.
    if (view.step === "review") {
      const pos = el.selectionStart;
      renderMain();
      const again = document.querySelector(`[data-act="${CSS.escape(act)}"]`);
      if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch { /* not a text input */ } }
    }
  }
});

// ---------------------------------------------------------------------- search

let searchTimer = null;
function queueSearch(q) {
  view.searchQuery = q;
  clearTimeout(searchTimer);
  if (!q.trim()) {
    view.searchResults = null;
    view.searching = false;
    renderMain();
    return;
  }
  view.searching = true;
  renderSearchOnly();
  searchTimer = setTimeout(() => runSearch(q), 260);
}

/** Re-render just the results, so typing does not steal focus from the box. */
function renderSearchOnly() {
  if (view.step !== "packages") return;
  const box = document.querySelector('[data-act="search"]');
  const pos = box ? box.selectionStart : null;
  renderMain();
  const again = document.querySelector('[data-act="search"]');
  if (again && document.activeElement !== again) {
    again.focus();
    if (pos != null) try { again.setSelectionRange(pos, pos); } catch { /* ignore */ }
  }
}

async function runSearch(q) {
  searchAbort?.abort();
  searchAbort = new AbortController();
  try {
    const results = await search.searchPackages(q, {
      channel: state.meta.channel,
      system: state.meta.system,
      signal: searchAbort.signal,
    });
    if (view.searchQuery !== q) return;
    view.searchOnline = true;
    view.searchResults = results;
  } catch (e) {
    if (e.name === "AbortError") return;
    view.searchOnline = false;
    view.searchReason = e.message;
    view.searchResults = search.searchCatalog(q, cat);
  } finally {
    if (view.searchQuery === q) {
      view.searching = false;
      renderSearchOnly();
    }
  }
}

/** Work out early whether the live index is reachable, for the status dot. */
async function probeSearch() {
  try {
    await search.resolveIndex(state.meta.channel);
    view.searchOnline = true;
  } catch (e) {
    view.searchOnline = false;
    view.searchReason = e.message;
  }
  if (view.step === "packages") renderMain();
}

// ------------------------------------------------------------------- keyboard

document.addEventListener("keydown", (ev) => {
  // Cards are divs with role="button" (they contain links, which a real button
  // may not), so they need Enter and Space wired up by hand.
  const pressable = ev.target.closest('[role="button"][data-act]');
  if (pressable && (ev.key === "Enter" || ev.key === " ")) {
    ev.preventDefault();
    pressable.click();
    return;
  }
  if (ev.target.matches("input, select, textarea")) return;
  const idx = ui.STEPS.findIndex((s) => s.id === view.step);
  if (ev.key === "ArrowRight" && idx < ui.STEPS.length - 1) {
    view.step = ui.STEPS[idx + 1].id; render();
  } else if (ev.key === "ArrowLeft" && idx > 0) {
    view.step = ui.STEPS[idx - 1].id; render();
  } else if (ev.key === "/") {
    ev.preventDefault();
    view.step = "packages";
    render();
    document.querySelector('[data-act="search"]')?.focus();
  }
});

// Restore the saved theme before first paint of the shell.
try {
  const saved = localStorage.getItem("baselayer.theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
} catch { /* ignore */ }

boot();
