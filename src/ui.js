// View layer. Every function returns an HTML string; app.js owns state and
// events, and re-renders the active step on change. Interactive elements carry
// data-act attributes that app.js dispatches on.

import { logoTile, svg } from "./icons.js";
import { CHANNELS, SYSTEMS, activeToggles } from "./state.js";

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const attr = (s) => esc(s).replace(/`/g, "&#96;");

export const STEPS = [
  { id: "start", name: "Start", num: 1 },
  { id: "basics", name: "Basics", num: 2 },
  { id: "machine", name: "Machine", num: 3 },
  { id: "desktop", name: "Desktop", num: 4 },
  { id: "packages", name: "Packages", num: 5 },
  { id: "services", name: "Services", num: 6 },
  { id: "security", name: "Security", num: 7 },
  { id: "flakes", name: "Flake inputs", num: 8 },
  { id: "review", name: "Review & export", num: 9 },
];

// ---------------------------------------------------------------- shared bits

function card({ id, act, on, tile, title, desc, sub = null, pills = [], docs = null, brand = null }) {
  const p = pills.map((x) => `<span class="pill ${x.cls || ""}">${esc(x.text)}</span>`).join("");
  const link = docs
    ? `<a class="faint small" href="${attr(docs)}" target="_blank" rel="noopener noreferrer"
         data-noact="1" title="Documentation">docs</a>`
    : "";
  return `<div class="card" role="button" tabindex="0" aria-pressed="${!!on}" data-act="${act}" data-id="${attr(id)}"${
    brand ? ` style="--brand:${attr(brand)}"` : ""}>
    ${tile}
    <span class="body">
      <span class="title">${esc(title)}${p}</span>
      ${sub ? `<span class="sub">${esc(sub)}</span>` : ""}
      <span class="desc">${esc(desc)}</span>
      ${link ? `<span class="desc">${link}</span>` : ""}
    </span>
  </div>`;
}

function switchRow(act, id, checked, title, desc) {
  return `<label class="switch">
    <input type="checkbox" data-act="${act}" data-id="${attr(id)}" ${checked ? "checked" : ""}>
    <span class="txt"><b>${esc(title)}</b><span>${esc(desc)}</span></span>
  </label>`;
}

function field(label, inner, note) {
  return `<div class="field"><label>${esc(label)}</label>${inner}${
    note ? `<span class="note">${esc(note)}</span>` : ""}</div>`;
}

const textInput = (act, value, placeholder = "", bad = false) =>
  `<input type="text" data-act="${act}" value="${attr(value)}" placeholder="${attr(placeholder)}" class="${bad ? "bad" : ""}" spellcheck="false" autocomplete="off">`;

const select = (act, options, current) =>
  `<select data-act="${act}">${options
    .map((o) => `<option value="${attr(o.id)}" ${o.id === current ? "selected" : ""}>${esc(o.name)}</option>`)
    .join("")}</select>`;

const head = (title, sub) =>
  `<div class="step-head"><h2>${esc(title)}</h2><p>${esc(sub)}</p></div>`;

const section = (title, hint, sub, body) => `<div class="section">
  <h3>${esc(title)}${hint ? `<span class="hint">${esc(hint)}</span>` : ""}</h3>
  ${sub ? `<p class="sub">${esc(sub)}</p>` : ""}
  ${body}</div>`;

// ---------------------------------------------------------------------- steps

export function stepStart(state, cat) {
  const cards = cat.bundles.items.map((b) => card({
    id: b.id, act: "bundle", on: state.bundle === b.id,
    tile: logoTile({ brand: b.brand, glyph: b.glyph }, { size: 40 }),
    title: b.name, desc: b.desc, sub: b.tagline, brand: b.brand,
  })).join("");

  return head("Start from something",
    "Pick a starting point and adjust it, or skip straight to the steps on the left and build it up yourself. Nothing here is locked in - a bundle just ticks boxes for you.")
    + `<div class="grid g2">${cards}</div>`
    + section("Or start from nothing", null,
      "An empty configuration with sensible defaults: UEFI boot, zram swap, NetworkManager and the firewall on.",
      `<button class="btn" data-act="reset">Clear everything and start blank</button>`);
}

export function stepBasics(state) {
  const m = state.meta;
  const badUser = !/^[a-z_][a-z0-9_-]*$/.test(m.username);
  const badHost = !/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(m.hostname);

  return head("Basics", "Who uses this machine and what it is called. These land in the users and networking sections of the config.")
    + section("Identity", null, null, `<div class="grid g3">
        ${field("Hostname", textInput("meta.hostname", m.hostname, "nixos", badHost), badHost ? "Letters, digits and hyphens only." : "How the machine appears on the network.")}
        ${field("Username", textInput("meta.username", m.username, "user", badUser), badUser ? "Must start with a lowercase letter." : "Your login account, added to the wheel group.")}
        ${field("Full name", textInput("meta.fullName", m.fullName, "optional"), "Shown on the login screen.")}
      </div>`)
    + section("Locale", null, null, `<div class="grid g3">
        ${field("Time zone", textInput("meta.timezone", m.timezone, "Europe/London"), "An IANA name, e.g. America/New_York.")}
        ${field("Locale", textInput("meta.locale", m.locale, "en_US.UTF-8"))}
        ${field("Console keymap", textInput("meta.keymap", m.keymap, "us"), "Also used for the X11 layout.")}
      </div>`)
    + section("Target", null,
      "The channel decides which nixpkgs your machine tracks. Options move between releases, and the generated config is adjusted to match whichever you pick.",
      `<div class="grid g3">
        ${field("Channel", select("meta.channel", CHANNELS, m.channel),
          (CHANNELS.find((c) => c.id === m.channel) || {}).desc)}
        ${field("Architecture", select("meta.system", SYSTEMS, m.system))}
        ${field("Output format", select("meta.format", [
          { id: "flake", name: "Flake (flake.nix + configuration.nix)" },
          { id: "classic", name: "Classic (configuration.nix only)" },
        ], m.format), m.format === "flake"
          ? "Pinned inputs and reproducible rebuilds. Needed for the GitHub inputs step."
          : "The traditional channel-based setup. Simpler, no lock file.")}
      </div>`);
}

export function stepMachine(state, cat) {
  const hw = cat.hardware;
  const pick = (group, act, cur) => hw[group].map((x) => card({
    id: x.id, act, on: cur === x.id,
    tile: logoTile({ brand: x.brand || "#7a8699", glyph: x.glyph || "cog" }, { size: 34 }),
    title: x.name, desc: x.desc || "", docs: x.docs,
    pills: x.unfree ? [{ text: "unfree", cls: "unfree" }] : [],
  })).join("");

  const simple = (group, act, cur) => hw[group].map((x) =>
    `<div class="card compact" role="button" tabindex="0" aria-pressed="${cur === x.id}" data-act="${act}" data-id="${attr(x.id)}">
      <span class="body"><span class="title">${esc(x.name)}</span>
      ${x.desc ? `<span class="desc">${esc(x.desc)}</span>` : ""}</span>
    </div>`).join("");

  return head("Machine", "What this box is and what is inside it. This drives the boot loader, graphics drivers and power management.")
    + section("What is it for", null, null, `<div class="grid g3">${pick("profiles", "profile", state.profile)}</div>`)
    + section("Graphics", null, "Pick what the machine actually has. The wrong driver here is the most common reason a first boot ends at a black screen.",
      `<div class="grid g3">${pick("gpu", "gpu", state.gpu)}</div>`)
    + section("Boot", null, null, `<div class="grid g3">${simple("firmware", "firmware", state.firmware)}</div>`)
    + section("CPU", "microcode updates", null, `<div class="grid g4">${simple("cpu", "cpu", state.cpu)}</div>`)
    + section("Root filesystem", null, "This only adds maintenance jobs for the filesystem you already have - it does not format anything.",
      `<div class="grid g3">${simple("filesystem", "filesystem", state.filesystem)}</div>`)
    + section("Swap", null, null, `<div class="grid g3">${simple("swap", "swap", state.swap)}</div>`)
    + section("Extras", null, null, `<div class="grid g2">
        ${switchRow("opt", "bluetooth", state.opts.bluetooth || ["laptop", "htpc"].includes(state.profile), "Bluetooth", "Enabled automatically for laptops and media boxes.")}
        ${switchRow("opt", "printing", state.opts.printing, "Printing", "CUPS with driverless discovery on the local network.")}
        ${switchRow("opt", "flatpak", state.opts.flatpak, "Flatpak", "For applications that are not in nixpkgs.")}
        ${switchRow("opt", "appimage", state.opts.appimage, "AppImage support", "Run .AppImage files directly via binfmt.")}
        ${switchRow("net", "ssh", state.net.ssh, "SSH server", "Remote login. Hardened separately on the Security step.")}
        ${switchRow("opt", "optimise", state.opts.optimise, "Automatic store upkeep", "Weekly garbage collection and store deduplication.")}
      </div>`);
}

export function stepDesktop(state, cat) {
  const des = cat.desktops.items;
  const groups = [
    ["Full desktop environments", des.filter((d) => d.kind === "de")],
    ["Window managers and compositors", des.filter((d) => d.kind === "wm")],
    ["Headless", des.filter((d) => d.kind === "none")],
  ];
  const ramLabel = { low: "light", medium: "medium", high: "heavy" };

  const body = groups.map(([name, items]) => section(name, null, null,
    `<div class="grid g3">${items.map((d) => card({
      id: d.id, act: "desktop", on: state.desktop === d.id,
      tile: logoTile(d, { size: 38 }),
      title: d.name, desc: d.desc, docs: d.docs,
      pills: [
        ...(d.wayland ? [{ text: "Wayland" }] : []),
        ...(d.x11 && !d.wayland ? [{ text: "X11" }] : []),
        ...(d.ram ? [{ text: ramLabel[d.ram] }] : []),
        ...(d.channels ? [{ text: d.channels.join("/") + " only", cls: "unfree" }] : []),
      ],
    })).join("")}</div>`)).join("");

  const cur = des.find((d) => d.id === state.desktop);
  const dmOptions = cat.desktops.displayManagers;
  const login = cur && cur.id !== "none"
    ? section("Login screen", null,
        `"Match the desktop" uses ${esc((dmOptions.find((x) => x.id === cur.dm) || { name: "the usual choice" }).name)} for ${esc(cur.name)}.`,
        `<div class="grid g3">${dmOptions.map((dm) =>
          `<div class="card compact" role="button" tabindex="0" aria-pressed="${state.loginManager === dm.id}" data-act="loginManager" data-id="${attr(dm.id)}">
            <span class="body"><span class="title">${esc(dm.name)}</span><span class="desc">${esc(dm.desc)}</span></span>
          </div>`).join("")}</div>
        <div style="margin-top:10px">${switchRow("opt", "autoLogin", state.opts.autoLogin, "Log in automatically", "Skip the password prompt on boot. Convenient on a media box, risky on a laptop.")}</div>`)
    : "";

  return head("Desktop", "One desktop environment or window manager. Everything else on the machine is unaffected by this choice.")
    + body + login;
}

export function stepPackages(state, cat, view) {
  const cats = cat.packages.categories;
  const counts = new Map();
  for (const p of cat.packages.items) counts.set(p.cat, (counts.get(p.cat) || 0) + 1);
  const active = view.pkgCat || "all";
  const items = active === "all"
    ? cat.packages.items
    : cat.packages.items.filter((p) => p.cat === active);

  const tabs = `<div class="cat-tabs">
    <button data-act="pkgCat" data-id="all" aria-pressed="${active === "all"}">All<span class="n">${cat.packages.items.length}</span></button>
    ${cats.map((c) => `<button data-act="pkgCat" data-id="${attr(c.id)}" aria-pressed="${active === c.id}">${esc(c.name)}<span class="n">${counts.get(c.id) || 0}</span></button>`).join("")}
  </div>`;

  const list = `<div class="grid g3">${items.map((p) => card({
    id: p.id, act: "pkg", on: state.packages.includes(p.id),
    tile: logoTile(p, { size: 34 }),
    title: p.name, desc: p.desc, docs: p.docs,
    pills: [
      ...(p.unfree ? [{ text: "unfree", cls: "unfree" }] : []),
      ...(p.module ? [{ text: "module", cls: "module" }] : []),
    ],
  })).join("")}</div>`;

  const chosen = state.packages.length + state.extra.length;
  const selected = chosen
    ? section("Selected", `${chosen}`, null, `<div class="chips">
        ${state.packages.map((id) => {
          const p = cat.packages.items.find((x) => x.id === id);
          return p ? `<span class="chip">${logoTile(p, { size: 18 })}${esc(p.name)}
            <button data-act="pkg" data-id="${attr(id)}" title="Remove" aria-label="Remove ${attr(p.name)}">&times;</button></span>` : "";
        }).join("")}
        ${state.extra.map((p) => `<span class="chip">${logoTile({ brand: "#5277c3", glyph: "package" }, { size: 18 })}<span class="mono">${esc(p.attr)}</span>
          <button data-act="unextra" data-id="${attr(p.attr)}" title="Remove" aria-label="Remove ${attr(p.attr)}">&times;</button></span>`).join("")}
      </div>`)
    : "";

  return head("Packages", "The curated list below covers the common ground. For anything else, search the whole of nixpkgs - the same index search.nixos.org uses.")
    + searchBlock(state, view)
    + selected
    + section("Catalog", null, null, tabs + list);
}

function searchBlock(state, view) {
  const status = view.searchOnline === false
    ? `<span class="search-status"><span class="dot off"></span>offline - searching the built-in catalog${view.searchReason ? ` (${esc(view.searchReason)})` : ""}</span>`
    : view.searchOnline
      ? `<span class="search-status"><span class="dot live"></span>live nixpkgs (${esc(state.meta.channel)})</span>`
      : `<span class="search-status"><span class="dot"></span>connecting…</span>`;

  let results = "";
  if (view.searching) results = `<div class="empty"><span class="spin"></span></div>`;
  else if (view.searchResults?.length) {
    results = `<div class="results">${view.searchResults.map((r) => {
      const already = state.extra.some((x) => x.attr === r.attr) ||
        (r.catalogId && state.packages.includes(r.catalogId));
      return `<button class="result" data-act="addfound" data-id="${attr(r.attr)}" type="button" ${already ? "disabled" : ""}>
        ${logoTile({ brand: r.unfree ? "#9a6206" : "#5277c3", glyph: "package" }, { size: 30 })}
        <span class="body">
          <span class="attr">${esc(r.attr)} <span class="ver">${esc(r.version)}</span></span>
          <span class="desc">${esc(r.desc || "no description")}</span>
        </span>
        ${r.unfree ? `<span class="pill unfree">unfree</span>` : ""}
        <span class="add">${already ? "added" : "add +"}</span>
      </button>`;
    }).join("")}</div>`;
  } else if (view.searchQuery && view.searchQuery.length > 1) {
    results = `<div class="empty">Nothing matched "${esc(view.searchQuery)}".</div>`;
  }

  return section("Search all of nixpkgs", null, null,
    `<div class="searchbar">
      <span class="wrap">${svg("search", { size: 16 })}
        <input type="search" data-act="search" value="${attr(view.searchQuery || "")}"
          placeholder="ripgrep, blender, obs…" spellcheck="false" autocomplete="off">
      </span>
      ${status}
    </div>${results}`);
}

export function stepServices(state, cat) {
  const cats = cat.services.categories;
  const byCat = new Map();
  for (const s of cat.services.items) {
    if (!byCat.has(s.cat)) byCat.set(s.cat, []);
    byCat.get(s.cat).push(s);
  }

  const groups = cats.filter((c) => byCat.has(c.id)).map((c) =>
    section(c.name, `${byCat.get(c.id).filter((s) => state.services.includes(s.id)).length || ""}`, null,
      `<div class="grid g3">${byCat.get(c.id).map((s) => card({
        id: s.id, act: "svc", on: state.services.includes(s.id),
        tile: logoTile(s, { size: 34 }),
        title: s.name, desc: s.desc, docs: s.docs,
        pills: [
          ...(s.webPort ? [{ text: `:${s.webPort}` }] : []),
          ...(s.unfree ? [{ text: "unfree", cls: "unfree" }] : []),
          ...(s.secrets ? [{ text: "needs secret", cls: "unfree" }] : []),
        ],
      })).join("")}</div>`)).join("");

  const webCount = state.services
    .map((id) => cat.services.items.find((s) => s.id === id))
    .filter((s) => s && s.web && !s.ownsHttp).length;

  const proxy = section("Reverse proxy", null,
    "One entry point for everything with a web interface, on a real hostname with automatic HTTPS. Without it you reach each service by port number.",
    switchRow("proxy", "enabled", state.proxy.enabled,
      "Put web services behind a reverse proxy",
      webCount ? `${webCount} selected service${webCount > 1 ? "s" : ""} would be published.` : "Nothing selected to publish yet.")
    + (state.proxy.enabled ? `<div class="grid g3" style="margin-top:10px">
        ${field("Engine", select("proxy.engine", [
          { id: "caddy", name: "Caddy - certificates handled for you" },
          { id: "nginx", name: "nginx - more knobs, more setup" },
        ], state.proxy.engine))}
        ${field("Base domain", textInput("proxy.baseDomain", state.proxy.baseDomain, "home.example.com"),
          "Services are published as <name>.<domain>.")}
        ${field("ACME contact email", textInput("proxy.email", state.proxy.email, "you@example.com"),
          "Where Let's Encrypt sends expiry warnings.")}
      </div>` : ""));

  return head("Self-hosted services",
    "Each of these is a real NixOS module with defaults filled in, its ports collected into the firewall, and a note about anything you still have to do by hand.")
    + proxy + groups;
}

export function stepSecurity(state, cat) {
  const on = activeToggles(state, cat.security);
  const levels = cat.security.levels.map((l) => `
    <div class="card" role="button" tabindex="0" aria-pressed="${state.security === l.id}" data-act="seclevel" data-id="${attr(l.id)}">
      ${logoTile({ brand: l.brand, glyph: "shield" }, { size: 38 })}
      <span class="body">
        <span class="title">${esc(l.name)}${"<span class='pill brand' style='--brand:" + l.brand + "'>" + "▮".repeat(l.score) + "</span>"}</span>
        <span class="desc">${esc(l.desc)}</span>
        <span class="desc faint">Best for: ${esc(l.bestFor)}</span>
      </span>
    </div>`).join("");

  const impact = { none: "", low: "low impact", medium: "changes behaviour", high: "breaks things" };
  const toggles = cat.security.toggles.map((t) => {
    const isOn = on.has(t.id);
    const level = cat.security.levels.find((l) => l.id === state.security);
    const fromLevel = level.toggles.includes(t.id);
    const overridden = t.id in (state.toggles || {}) && state.toggles[t.id] !== fromLevel;
    const pills = (t.impact && t.impact !== "none"
        ? `<span class="pill ${t.impact === "high" ? "unfree" : ""}">${esc(impact[t.impact])}</span>` : "")
      + (overridden ? `<span class="pill module">changed</span>` : "");
    const extra = (t.warn ? `<span style="color:var(--warn)">${esc(t.warn)}</span> ` : "")
      + (t.docs ? `<a href="${attr(t.docs)}" target="_blank" rel="noopener noreferrer" data-noact="1">documentation</a>` : "");
    return `<div>
      <label class="switch">
        <input type="checkbox" data-act="toggle" data-id="${attr(t.id)}" ${isOn ? "checked" : ""}>
        <span class="txt"><b>${esc(t.name)}${pills}</b><span>${esc(t.desc)}</span></span>
      </label>
      ${extra ? `<div class="small" style="padding:4px 11px 0">${extra}</div>` : ""}
    </div>`;
  }).join("");

  return head("Security",
    "Pick a level, then change anything individually. Every switch says what it costs you - a hardened machine that you cannot use is not a win.")
    + section("Level", null, null, `<div class="grid g2">${levels}</div>`)
    + section("Individual controls", `${on.size} on`,
      "These start from the level above. Anything you change here sticks even if you switch level.",
      `<div class="stack">${toggles}</div>
       <div style="margin-top:10px"><button class="btn ghost sm" data-act="resetToggles">Reset to the level defaults</button></div>`);
}

export function stepFlakes(state, cat) {
  if (state.meta.format !== "flake")
    return head("Flake inputs", "These need the flake output format.")
      + `<div class="notice info"><span class="ico">${svg("cog", { size: 18 })}</span>
        <div><b>Classic output selected</b>
        <p>A plain configuration.nix has no way to pull in an external repository. Switch the output
        format to Flake on the Basics step to use these.</p>
        <div class="fix"><button class="btn sm" data-act="useFlake">Switch to flake output</button></div></div></div>`;

  const cards = cat.flakes.items.map((f) => card({
    id: f.id, act: "flake", on: state.flakes.includes(f.id),
    tile: logoTile(f, { size: 36 }),
    title: f.name, desc: f.desc, docs: f.docs,
    pills: [{ text: f.owner, cls: "brand" }],
  })).join("");

  return head("Flake inputs from GitHub",
    "Extra repositories pinned in flake.nix and added to the module list. Each one is a separate project with its own documentation - read it before you depend on it.")
    + `<div class="grid g2">${cards}</div>`
    + (state.flakes.length ? section("Notes", null, null,
        cat.flakes.items.filter((f) => state.flakes.includes(f.id) && f.note)
          .map((f) => `<div class="notice info"><span class="ico">${svg("cog", { size: 17 })}</span>
            <div><b>${esc(f.name)}</b><p>${esc(f.note)}</p></div></div>`).join("") || "<p class='muted small'>Nothing extra to flag.</p>")
      : "");
}

// ---------------------------------------------------------------- review step

export function stepReview(state, cat, result, findings, view) {
  const st = result.stats;
  const catName = new Map(cat.packages.categories.map((c) => [c.id, c.name]));

  const errors = findings.filter((f) => f.level === "error");
  const warnings = findings.filter((f) => f.level === "warning");
  const infos = findings.filter((f) => f.level === "info");

  const noticeIcon = { error: "shield", warning: "shield", info: "cog", good: "shield" };
  const notice = (f) => `<div class="notice ${f.level}">
    <span class="ico">${svg(noticeIcon[f.level], { size: 17 })}</span>
    <div><b>${esc(f.title)}</b><p>${esc(f.detail)}</p>
    ${f.fix ? `<div class="fix">${esc(f.fix)}</div>` : ""}</div></div>`;

  const checks = errors.length
    ? errors.map(notice).join("") + warnings.map(notice).join("")
    : warnings.length
      ? `<div class="notice good"><span class="ico">${svg("shield", { size: 17 })}</span>
         <div><b>No blocking problems</b><p>Nothing here stops the config evaluating. The notes below are worth a read.</p></div></div>`
        + warnings.map(notice).join("")
      : `<div class="notice good"><span class="ico">${svg("shield", { size: 17 })}</span>
         <div><b>Looks consistent</b><p>No conflicts found between the choices you made.</p></div></div>`;

  const stats = `<div class="stats">
    <div class="stat"><b>${st.packages}</b><span>packages</span></div>
    <div class="stat"><b>${st.services}</b><span>services</span></div>
    <div class="stat"><b>${st.tcpPorts.length + st.udpPorts.length}</b><span>open ports</span></div>
    <div class="stat"><b>${st.securityToggles}</b><span>hardening switches</span></div>
    <div class="stat"><b>${st.unfree.length}</b><span>unfree</span></div>
    <div class="stat"><b>${st.lines}</b><span>lines of Nix</span></div>
  </div>`;

  // package breakdown
  const breakdown = st.byCategory.length ? `<div class="table-wrap"><table class="data">
    <thead><tr><th>Kind</th><th>Count</th><th>Share</th></tr></thead><tbody>
    ${st.byCategory.map((c) => {
      const pct = Math.round((c.n / Math.max(1, st.packages)) * 100);
      return `<tr><td>${esc(c.id === "search" ? "Added from search" : catName.get(c.id) || c.id)}</td>
        <td class="mono">${c.n}</td>
        <td><span style="display:inline-block;height:7px;border-radius:4px;background:var(--accent);width:${Math.max(3, pct)}%"></span>
        <span class="faint small"> ${pct}%</span></td></tr>`;
    }).join("")}</tbody></table></div>` : "";

  // logo wall
  const chosenPkgs = state.packages.map((id) => cat.packages.items.find((p) => p.id === id)).filter(Boolean);
  const wall = chosenPkgs.length || state.extra.length ? `<div class="logo-wall">
    ${chosenPkgs.map((p) => `<span class="chip">${logoTile(p, { size: 22 })}
      <a href="${attr(p.home)}" target="_blank" rel="noopener noreferrer" data-noact="1">${esc(p.name)}</a></span>`).join("")}
    ${state.extra.map((p) => `<span class="chip">${logoTile({ brand: "#5277c3", glyph: "package" }, { size: 22 })}
      ${p.home ? `<a href="${attr(p.home)}" target="_blank" rel="noopener noreferrer" data-noact="1">${esc(p.attr)}</a>` : `<span class="mono">${esc(p.attr)}</span>`}</span>`).join("")}
  </div>` : `<p class="muted small">No packages selected yet.</p>`;

  // documentation table
  const docRows = [
    ...chosenPkgs.map((p) => ({ tile: logoTile(p, { size: 22 }), name: p.name, attr: p.attr,
      kind: catName.get(p.cat) || p.cat, home: p.home, docs: p.docs, unfree: p.unfree })),
    ...state.extra.map((p) => ({ tile: logoTile({ brand: "#5277c3", glyph: "package" }, { size: 22 }),
      name: p.name || p.attr, attr: p.attr, kind: "from search", home: p.home,
      docs: `https://search.nixos.org/packages?channel=${encodeURIComponent(state.meta.channel)}&show=${encodeURIComponent(p.attr)}`,
      unfree: p.unfree })),
  ];
  const docsTable = docRows.length ? `<div class="table-wrap"><table class="data">
    <thead><tr><th></th><th>Package</th><th>Attribute</th><th>Kind</th><th>Links</th></tr></thead><tbody>
    ${docRows.map((r) => `<tr>
      <td style="width:34px">${r.tile}</td>
      <td>${esc(r.name)}${r.unfree ? ` <span class="pill unfree">unfree</span>` : ""}</td>
      <td class="mono">${esc(r.attr)}</td>
      <td class="faint">${esc(r.kind)}</td>
      <td>${r.home ? `<a href="${attr(r.home)}" target="_blank" rel="noopener noreferrer" data-noact="1">home</a>` : ""}
          ${r.docs ? ` · <a href="${attr(r.docs)}" target="_blank" rel="noopener noreferrer" data-noact="1">docs</a>` : ""}</td>
    </tr>`).join("")}</tbody></table></div>` : "";

  // services table
  const chosenSvcs = state.services.map((id) => cat.services.items.find((s) => s.id === id)).filter(Boolean);
  const svcTable = chosenSvcs.length ? `<div class="table-wrap"><table class="data">
    <thead><tr><th></th><th>Service</th><th>Reach it at</th><th>Option</th><th>Links</th></tr></thead><tbody>
    ${chosenSvcs.map((s) => {
      const where = s.webPort
        ? (state.proxy.enabled && s.web && !s.ownsHttp
            ? `https://${s.id.replace(/-srv$/, "")}.${state.proxy.baseDomain}`
            : `http://${state.meta.hostname}:${s.webPort}`)
        : "-";
      return `<tr>
        <td style="width:34px">${logoTile(s, { size: 22 })}</td>
        <td>${esc(s.name)}</td>
        <td class="mono">${esc(where)}</td>
        <td class="mono">${esc(s.opt || "")}</td>
        <td><a href="${attr(s.docs)}" target="_blank" rel="noopener noreferrer" data-noact="1">docs</a>
            · <a href="https://search.nixos.org/options?channel=${encodeURIComponent(state.meta.channel)}&query=${encodeURIComponent(s.opt || s.id)}" target="_blank" rel="noopener noreferrer" data-noact="1">options</a></td>
      </tr>`;
    }).join("")}</tbody></table></div>` : "";

  const ports = (st.tcpPorts.length || st.udpPorts.length) ? `<div class="row tight">
    ${st.tcpPorts.map((p) => `<span class="pill">tcp ${p}</span>`).join("")}
    ${st.udpPorts.map((p) => `<span class="pill">udp ${p}</span>`).join("")}
  </div>` : `<p class="muted small">No inbound ports are open.</p>`;

  const secrets = result.secrets.length ? `<p class="sub">These files must exist before the first rebuild, or the service will not start. They are deliberately not in the config - a config gets copied around, and these should not.</p>
    ${result.secrets.map((s) => `<div style="margin-bottom:10px">
      <div class="row tight"><b class="mono small">${esc(s.path)}</b><span class="faint small">${esc(s.service)}</span></div>
      <div class="faint small" style="margin-bottom:4px">${esc(s.desc)}</div>
      <code class="cmd">${esc(s.cmd)}</code>
    </div>`).join("")}` : `<p class="muted small">Nothing extra to create. Every service you selected starts on its own.</p>`;

  const notes = result.notes.length
    ? `<ul class="muted small" style="margin:0;padding-left:18px">${result.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`
    : "";

  return head("Review & export",
    `${st.packages} packages, ${st.services} services and ${st.lines} lines of Nix, targeting ${st.channel}.`)
    + stats
    + section("Checks", `${errors.length} error${errors.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`, null, checks)
    + section("Get the files", null, null, exportBlock(state, result, view))
    + section("What you selected", null, null, wall)
    + (breakdown ? section("Package breakdown", null, null, breakdown) : "")
    + (docsTable ? section("Documentation", null, "Every package, where it came from and where to read about it.", docsTable) : "")
    + (svcTable ? section("Services", null, "Where each service will answer once the machine is up.", svcTable) : "")
    + section("Open ports", null, "Collected from every service you enabled and written into the firewall.", ports)
    + section("Secrets to create", `${result.secrets.length}`, null, secrets)
    + (infos.length ? section("Worth knowing", null, null, infos.map(notice).join("")) : "")
    + (notes ? section("Generator notes", null, null, notes) : "");
}

function exportBlock(state, result, view) {
  const payloadReady = !!view.payload;
  const tooBig = view.payload && view.payload.length > 120000;

  const curl = payloadReady
    ? `<code class="cmd" id="curl-cmd">${esc(view.curlCmd)}</code>`
    : `<div class="empty"><span class="spin"></span></div>`;

  const paste = view.pasteUrl
    ? `<div class="notice good"><span class="ico">${svg("cloud", { size: 17 })}</span>
        <div><b>Uploaded</b>
        <p>Fetch it with:</p>
        <code class="cmd">curl -O ${esc(view.pasteUrl)}</code>
        <div class="fix">Hosted by ${esc(view.pasteHost)} and will expire. Anyone with the link can read it, so do not put secrets in the config first.</div></div></div>`
    : "";

  return `<div class="btn-row">
      <button class="btn primary" data-act="download-zip">${svg("download", { size: 16 })} Download all files (.zip)</button>
      ${result.files.map((f) => `<button class="btn" data-act="download-one" data-id="${attr(f.name)}">${esc(f.name)}</button>`).join("")}
      <button class="btn" data-act="copy-config">Copy configuration.nix</button>
      <button class="btn" data-act="share">${svg("network", { size: 16 })} Copy share link</button>
    </div>

    <details class="more" open>
      <summary>Put it straight on the machine with curl</summary>
      <div>
        <p class="muted small">This site is static, so there is no server that could generate a file at a URL.
        Instead the config travels inside the command: the host serves a fixed
        <a href="get.txt" target="_blank" rel="noopener">installer script</a>, and your configuration is
        the compressed argument after it. Run it in the NixOS installer and the files land in the current
        directory.</p>
        ${curl}
        <div class="btn-row" style="margin-top:8px">
          <button class="btn sm" data-act="copy-curl" ${payloadReady ? "" : "disabled"}>Copy command</button>
          <button class="btn sm" data-act="copy-curl-etc" ${payloadReady ? "" : "disabled"}>Copy for /etc/nixos</button>
          ${payloadReady ? `<span class="search-status">${view.payload.length.toLocaleString()} characters</span>` : ""}
        </div>
        ${tooBig ? `<div class="notice warning" style="margin-top:8px"><span class="ico">${svg("shield", { size: 17 })}</span>
          <div><b>That command is very long</b><p>Some shells refuse arguments this large. Download the
          files instead, or use the upload option below.</p></div></div>` : ""}
      </div>
    </details>

    <details class="more">
      <summary>Or upload it and get a plain URL</summary>
      <div>
        <p class="muted small">If you would rather <code>curl</code> a normal short link, the config can be
        posted to a third-party paste host. That means handing your configuration to someone else's server,
        so it is off by default and the command above needs no such thing.</p>
        <div class="btn-row">
          <button class="btn sm" data-act="publish" data-id="dpaste">Upload to dpaste.org</button>
          <button class="btn sm" data-act="publish" data-id="tmpfiles">Upload to tmpfiles.org</button>
        </div>
        ${view.pasteError ? `<div class="notice warning" style="margin-top:8px"><span class="ico">${svg("cloud", { size: 17 })}</span>
          <div><b>Upload failed</b><p>${esc(view.pasteError)}</p></div></div>` : ""}
        ${paste}
      </div>
    </details>`;
}

// ------------------------------------------------------------------- chrome

export function renderSteps(state, current, counts) {
  return STEPS.map((s) => {
    const n = counts[s.id];
    const alert = s.id === "review" && counts.errors > 0;
    return `<button data-act="step" data-id="${s.id}" aria-current="${s.id === current}">
      <span class="num">${s.num}</span>
      <span>${esc(s.name)}</span>
      ${n ? `<span class="badge ${alert ? "alert" : ""}">${esc(String(n))}</span>` : ""}
    </button>`;
  }).join("");
}

/** Small, forgiving Nix highlighter - enough to make the preview readable. */
export function highlight(code) {
  const out = [];
  for (const line of code.split("\n")) {
    if (/^\s*#/.test(line)) { out.push(`<span class="c">${esc(line)}</span>`); continue; }
    let html = "";
    let rest = line;
    const hash = rest.search(/(?<!["'\\])#/);
    let trailing = "";
    if (hash > -1 && !/["'].*#.*["']/.test(rest)) {
      trailing = `<span class="c">${esc(rest.slice(hash))}</span>`;
      rest = rest.slice(0, hash);
    }
    html += esc(rest)
      .replace(/&quot;(?:[^&]|&(?!quot;))*&quot;/g, (m) => `<span class="s">${m}</span>`)
      .replace(/\b(true|false|null|with|import|let|in|inherit|rec)\b/g, '<span class="k">$1</span>')
      .replace(/\b(\d+)\b/g, '<span class="n">$1</span>')
      .replace(/^(\s*)([\w.&quot;'-]+)(\s*=)/, '$1<span class="p">$2</span>$3');
    out.push(html + trailing);
  }
  return out.join("\n");
}

export function renderPreview(result, view) {
  const files = result.files;
  // configuration.nix is what people actually read, so it opens first even
  // though flake.nix comes first in the file list.
  const preferred = files.find((f) => f.name === "configuration.nix") || files[0];
  const activeName = files.some((f) => f.name === view.previewFile) ? view.previewFile : preferred.name;
  const file = files.find((f) => f.name === activeName);
  return `<div class="tabs" role="tablist">
      ${files.map((f) => `<button role="tab" aria-selected="${f.name === activeName}" data-act="previewFile" data-id="${attr(f.name)}">${esc(f.name)}</button>`).join("")}
      <span class="spacer"></span>
      <button class="btn ghost sm" data-act="copy-file" data-id="${attr(activeName)}" title="Copy this file">copy</button>
    </div>
    <pre class="code"><code>${highlight(file.content)}</code></pre>
    <div class="foot">
      <span>${file.content.split("\n").length} lines</span>
      <span>${(file.content.length / 1024).toFixed(1)} kB</span>
      <span class="spacer" style="flex:1"></span>
      <span>${esc(result.stats.channel)}</span>
    </div>`;
}
