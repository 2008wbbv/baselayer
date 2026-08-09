// Turns the app state into real NixOS files.
//
// The one hard constraint is that Nix forbids defining the same attribute
// twice in one attrset, so every emitted block records the option paths it
// owns and a block whose path collides with one already emitted is dropped
// rather than producing a config that fails to evaluate. Where two features
// legitimately want the same list-valued option, they `contribute` to it
// instead and the generator merges the values.

import { activeToggles, CHANNELS, LATEST_RELEASE } from "./state.js";

const RULE = "─";
const WIDTH = 74;

function header(title) {
  const left = `  # ${RULE.repeat(3)} ${title} `;
  return left + RULE.repeat(Math.max(3, WIDTH - left.length));
}

/** Option paths a snippet defines at its top level. */
export function ownedPaths(lines) {
  const out = [];
  let depth = 0;
  let inString = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trimStart();
    if (!inString && depth === 0) {
      const m = trimmed.match(/^([A-Za-z_][\w.'"-]*)\s*=/);
      if (m) out.push(m[1]);
    }
    // `''` blocks may contain anything; do not count brackets inside them.
    const quotes = (line.match(/''/g) || []).length;
    if (quotes % 2 === 1) inString = !inString;
    if (inString) continue;
    const opens = (line.match(/[{[]/g) || []).length;
    const closes = (line.match(/[}\]]/g) || []).length;
    depth += opens - closes;
  }
  return out;
}

const collides = (a, b) => a === b || a.startsWith(b + ".") || b.startsWith(a + ".");

function substitute(text, vars) {
  return text.replace(/%%([A-Z_]+)%%/g, (m, key) => (key in vars ? vars[key] : m));
}

/** Deterministic 8 hex chars, used for networking.hostId under ZFS. */
function hostId(seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(0, 8);
}

const quote = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const nixList = (items) => (items.length ? `[ ${items.join(" ")} ]` : "[ ]");

export function generate(state, cat) {
  const chan = CHANNELS.find((c) => c.id === state.meta.channel) || CHANNELS[0];
  const release = chan.release || LATEST_RELEASE;
  const user = state.meta.username || "user";
  const host = state.meta.hostname || "nixos";
  const isFlake = state.meta.format === "flake";

  const byId = (list) => new Map(list.map((x) => [x.id, x]));
  const pkgById = byId(cat.packages.items);
  const svcById = byId(cat.services.items);
  const dtopById = byId(cat.desktops.items);
  const flakeById = byId(cat.flakes.items);
  const toggleById = byId(cat.security.toggles);

  const pickNix = (item) =>
    (item.nixByChannel && item.nixByChannel[state.meta.channel]) || item.nix || [];

  // ---- resolve selections ---------------------------------------------------
  const desktop = dtopById.get(state.desktop) || dtopById.get("none");
  const gpu = cat.hardware.gpu.find((g) => g.id === state.gpu) || cat.hardware.gpu[0];
  const cpu = cat.hardware.cpu.find((c) => c.id === state.cpu) || cat.hardware.cpu[2];
  const firmware = cat.hardware.firmware.find((f) => f.id === state.firmware) || cat.hardware.firmware[0];
  const fs = cat.hardware.filesystem.find((f) => f.id === state.filesystem) || cat.hardware.filesystem[0];
  const swap = cat.hardware.swap.find((s) => s.id === state.swap) || cat.hardware.swap[0];
  const profile = cat.hardware.profiles.find((p) => p.id === state.profile) || cat.hardware.profiles[0];

  const selectedPkgs = state.packages.map((id) => pkgById.get(id)).filter(Boolean);
  const selectedSvcs = state.services.map((id) => svcById.get(id)).filter(Boolean);
  const selectedFlakes = isFlake ? state.flakes.map((id) => flakeById.get(id)).filter(Boolean) : [];
  const on = activeToggles(state, cat.security);
  const selectedToggles = [...on].map((id) => toggleById.get(id)).filter(Boolean);

  const notes = [];
  const secrets = [];
  const dropped = [];

  // ---- emission machinery ---------------------------------------------------
  const sections = [];
  const owners = new Map(); // option path -> what claimed it
  let current = null;

  const openSection = (title) => {
    current = { title, lines: [] };
    sections.push(current);
  };

  /** Try to emit a block. Returns false (and records it) if it would clash. */
  const emit = (lines, owner, { force = false } = {}) => {
    const list = Array.isArray(lines) ? lines : [lines];
    if (!list.length) return true;
    const paths = ownedPaths(list);
    if (!force) {
      for (const p of paths) {
        for (const [existing, who] of owners) {
          if (collides(p, existing)) {
            dropped.push({ owner, path: p, clashesWith: who });
            return false;
          }
        }
      }
    }
    for (const p of paths) if (!owners.has(p)) owners.set(p, owner);
    if (current.lines.length) current.lines.push("");
    for (const l of list) current.lines.push(l ? `  ${l}` : "");
    return true;
  };

  const comment = (text) => {
    if (current.lines.length) current.lines.push("");
    for (const l of text.split("\n")) current.lines.push(`  # ${l}`);
  };

  // ---- gather contributions to shared list options --------------------------
  const contributions = new Map();
  const contribute = (path, values) => {
    if (!contributions.has(path)) contributions.set(path, []);
    for (const v of values) if (!contributions.get(path).includes(v)) contributions.get(path).push(v);
  };
  for (const t of selectedToggles)
    for (const [path, values] of Object.entries(t.contributes || {})) contribute(path, values);

  // ---- firewall ports -------------------------------------------------------
  const proxyEngine = state.proxy.enabled ? state.proxy.engine : null;
  const tcp = new Set(state.net.extraTCP || []);
  const udp = new Set(state.net.extraUDP || []);
  if (state.net.ssh) tcp.add(22);
  if (proxyEngine) {
    tcp.add(80);
    tcp.add(443);
  }
  for (const s of selectedSvcs) {
    // With a reverse proxy in front, a web service is reached through it, so
    // its own port stays closed to the network.
    const behindProxy = proxyEngine && s.web && s.webPort && !s.ownsHttp;
    for (const p of s.ports?.tcp || []) if (!(behindProxy && p === s.webPort)) tcp.add(p);
    for (const p of s.ports?.udp || []) udp.add(p);
  }

  // ---- groups the user needs to be in --------------------------------------
  const groups = new Set(["wheel"]);
  if (state.net.networkManager) groups.add("networkmanager");
  const extraGroupDecls = new Set();
  for (const s of selectedSvcs) if (s.needsGroup) { groups.add(s.needsGroup); extraGroupDecls.add(s.needsGroup); }
  for (const p of selectedPkgs) if (p.group) groups.add(p.group);
  if (state.opts.printing || selectedSvcs.some((s) => s.id === "printing")) groups.add("lp");

  // ---- unfree ---------------------------------------------------------------
  const unfree = [];
  for (const p of selectedPkgs) if (p.unfree) unfree.push(p.name);
  for (const p of state.extra) if (p.unfree) unfree.push(p.name || p.attr);
  for (const s of selectedSvcs) if (s.unfree) unfree.push(s.name);
  if (gpu.unfree) unfree.push(gpu.name);
  const needsUnfree = unfree.length > 0;

  const needs32 = selectedPkgs.some((p) => p.needs32bit) || state.opts.gaming;

  // ---- template variables ---------------------------------------------------
  const baseVars = {
    USER: user,
    HOSTNAME: host,
    TIMEZONE: state.meta.timezone,
    HOSTID: hostId(host),
    BASEDOMAIN: state.proxy.baseDomain || "example.com",
    DOMAIN: state.proxy.enabled ? state.proxy.baseDomain : `${host}.local`,
    REL: release,
  };
  const varsFor = (svc) => ({
    ...baseVars,
    DOMAIN: state.proxy.enabled
      ? `${svc.id.replace(/-srv$/, "")}.${state.proxy.baseDomain || "example.com"}`
      : `${host}.local`,
  });

  // ==========================================================================
  // configuration.nix
  // ==========================================================================
  openSection(null);

  const flakeNote = isFlake
    ? "Rebuild with:  sudo nixos-rebuild switch --flake .#" + host
    : "Rebuild with:  sudo nixos-rebuild switch";
  const banner = [
    "# NixOS configuration generated by baselayer",
    `# Target: ${chan.name} (${state.meta.system})`,
    "#",
    "# hardware-configuration.nix is NOT generated here - it describes your",
    "# actual disks. Keep the one nixos-generate-config wrote for this machine.",
    "#",
    `# ${flakeNote}`,
    "",
    "{ config, lib, pkgs, ... }:",
    "",
    "{",
  ];

  // --- imports
  openSection("Imports");
  emit(["imports = [", "  ./hardware-configuration.nix", "];"], "core:imports");

  // --- boot
  openSection("Boot & firmware");
  if (firmware.note) comment(firmware.note);
  emit(pickNix(firmware), `firmware:${firmware.id}`);
  const hardened = on.has("hardened-kernel");
  if (hardened) emit(pickNix(toggleById.get("hardened-kernel")), "security:hardened-kernel");
  else if (state.meta.channel !== "25.11" && state.profile === "desktop")
    emit(["boot.kernelPackages = pkgs.linuxPackages_latest;"], "core:kernel");
  const blacklist = contributions.get("boot.blacklistedKernelModules");
  if (blacklist?.length)
    emit([
      "boot.blacklistedKernelModules = [",
      ...chunk(blacklist.map(quote), 6).map((row) => "  " + row.join(" ")),
      "];",
    ], "security:blacklist");
  if (fs.note) comment(fs.note);
  emit(pickNix(fs).map((l) => substitute(l, baseVars)), `fs:${fs.id}`);
  emit(pickNix(swap), `swap:${swap.id}`);

  // --- networking
  openSection("Networking");
  emit([`networking.hostName = ${quote(host)};`], "core:hostname");
  if (state.net.networkManager) emit(["networking.networkmanager.enable = true;"], "core:nm");
  else emit(["networking.useDHCP = lib.mkDefault true;"], "core:dhcp");

  const firewallOn = on.has("firewall");
  emit([`networking.firewall.enable = ${firewallOn};`], "core:firewall-enable");
  if (firewallOn) {
    const t = [...tcp].sort((a, b) => a - b);
    const u = [...udp].sort((a, b) => a - b);
    emit([`networking.firewall.allowedTCPPorts = ${nixList(t)};`], "core:firewall-tcp");
    emit([`networking.firewall.allowedUDPPorts = ${nixList(u)};`], "core:firewall-udp");
    if (!t.length && !u.length) comment("No inbound ports are open. Nothing can reach this machine.");
  }
  if (state.net.ssh && !on.has("ssh-hardening"))
    emit(["services.openssh.enable = true;"], "core:ssh");

  // --- locale
  openSection("Locale & time");
  emit([`time.timeZone = ${quote(state.meta.timezone)};`], "core:tz");
  emit([`i18n.defaultLocale = ${quote(state.meta.locale)};`], "core:locale");
  emit([`console.keyMap = ${quote(state.meta.keymap)};`], "core:keymap");

  // --- users
  openSection("Users");
  const shellPkg = selectedPkgs.find((p) => p.shell);
  const userLines = [
    `users.users.${user} = {`,
    "  isNormalUser = true;",
  ];
  if (state.meta.fullName) userLines.push(`  description = ${quote(state.meta.fullName)};`);
  userLines.push(`  extraGroups = [ ${[...groups].map(quote).join(" ")} ];`);
  if (shellPkg) userLines.push(`  shell = pkgs.${shellPkg.attr};`);
  userLines.push("  # Paste your public key here to log in over SSH.");
  userLines.push("  openssh.authorizedKeys.keys = [ ];");
  userLines.push("};");
  emit(userLines, "core:user");
  for (const g of extraGroupDecls) emit([`users.groups.${g} = { };`], `core:group:${g}`);
  if (state.net.ssh && !on.has("ssh-hardening"))
    notes.push("SSH is enabled with password login allowed. Add your public key and turn on the SSH hardening toggle before exposing this machine.");

  // --- desktop
  if (desktop.id !== "none") {
    openSection("Desktop");
    if (desktop.needsXserver) emit(["services.xserver.enable = true;"], "core:xserver");
    emit([`services.xserver.xkb.layout = ${quote(state.meta.keymap)};`], "core:xkb");
    if (desktop.note) comment(desktop.note);
    emit(pickNix(desktop), `desktop:${desktop.id}`);

    const dm = state.loginManager === "auto" ? desktop.dm : state.loginManager;
    emit(displayManager(dm, desktop, state.meta.channel), `dm:${dm}`);
    if (desktop.session && dm !== "none")
      emit([`services.displayManager.defaultSession = ${quote(desktop.session)};`], "core:session");
    if (state.opts.autoLogin && dm !== "none")
      emit([
        "services.displayManager.autoLogin = {",
        "  enable = true;",
        `  user = ${quote(user)};`,
        "};",
      ], "core:autologin");
    if (desktop.excludeOption && desktop.excludeDefaults?.length) {
      const prefix = desktop.excludePrefix || "";
      emit([
        `${desktop.excludeOption} = with pkgs; [`,
        ...desktop.excludeDefaults.map((p) => `  ${prefix}${p}`),
        "];",
      ], "core:exclude");
    }
    if (desktop.portal)
      emit([
        "xdg.portal = {",
        "  enable = true;",
        `  extraPortals = [ pkgs.${desktop.portal} ];`,
        "};",
      ], "core:portal");

    openSection("Audio");
    emit([
      "services.pulseaudio.enable = false;",
      "security.rtkit.enable = true;",
      "services.pipewire = {",
      "  enable = true;",
      "  alsa.enable = true;",
      "  alsa.support32Bit = true;",
      "  pulse.enable = true;",
      "  jack.enable = true;",
      "};",
    ], "core:audio");
  }

  // --- hardware
  openSection("Hardware");
  emit(["hardware.enableRedistributableFirmware = true;"], "core:firmware-blobs");
  if (gpu.note) comment(gpu.note);
  emit(pickNix(gpu), `gpu:${gpu.id}`);
  if (gpu.videoDrivers?.length)
    emit([`services.xserver.videoDrivers = [ ${gpu.videoDrivers.map(quote).join(" ")} ];`], "core:videodrv");
  emit(pickNix(cpu), `cpu:${cpu.id}`);
  const wantsBluetooth = state.opts.bluetooth || ["laptop", "htpc"].includes(state.profile);
  if (wantsBluetooth)
    emit([
      "hardware.bluetooth = {",
      "  enable = true;",
      `  powerOnBoot = ${state.profile !== "laptop"};`,
      "};",
    ], "core:bluetooth");
  emit(pickNix(profile), `profile:${profile.id}`);

  // --- programs (NixOS modules)
  const modulePkgs = selectedPkgs.filter((p) => p.module);
  if (modulePkgs.length) {
    openSection("Programs");
    comment("These ship a NixOS module, so they are enabled properly rather than\njust dropped into systemPackages.");
    for (const p of modulePkgs) {
      const src = (p.moduleByChannel && p.moduleByChannel[state.meta.channel]) || p.module;
      emit(src.split("\n"), `package:${p.id}`);
    }
  }

  // --- packages
  const plainPkgs = selectedPkgs.filter((p) => !p.module && !p.font);
  const fontPkgs = selectedPkgs.filter((p) => p.font);
  const extraPkgs = state.extra || [];
  if (plainPkgs.length || extraPkgs.length || desktop.packages?.length) {
    openSection("Packages");
    const catName = new Map(cat.packages.categories.map((c) => [c.id, c.name]));
    const grouped = new Map();
    for (const p of plainPkgs) {
      const k = catName.get(p.cat) || "Other";
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k).push(p.attr);
    }
    if (desktop.packages?.length)
      grouped.set(
        `${desktop.name} session tools - it does not pull these in itself`,
        desktop.packages,
      );
    if (extraPkgs.length) grouped.set("Added from nixpkgs search", extraPkgs.map((p) => p.attr));
    const lines = ["environment.systemPackages = with pkgs; ["];
    for (const [group, attrs] of grouped) {
      lines.push(`  # ${group}`);
      for (const a of [...new Set(attrs)].sort()) lines.push(`  ${a}`);
    }
    lines.push("];");
    emit(lines, "core:packages");
  }
  if (fontPkgs.length) {
    openSection("Fonts");
    emit([
      "fonts.enableDefaultPackages = true;",
      "fonts.packages = with pkgs; [",
      ...[...new Set(fontPkgs.map((p) => p.attr))].sort().map((a) => `  ${a}`),
      "];",
    ], "core:fonts");
  }

  // --- optional desktop extras
  const extraBits = [];
  if (state.opts.flatpak) extraBits.push({ lines: ["services.flatpak.enable = true;"], owner: "opt:flatpak" });
  if (state.opts.appimage) extraBits.push({ lines: ["programs.appimage = {", "  enable = true;", "  binfmt = true;", "};"], owner: "opt:appimage" });
  if (state.opts.printing && !selectedSvcs.some((s) => s.id === "printing"))
    extraBits.push({ lines: ["services.printing.enable = true;"], owner: "opt:printing" });
  if (extraBits.length) {
    openSection("Desktop extras");
    for (const b of extraBits) emit(b.lines, b.owner);
    if (state.opts.flatpak)
      notes.push("Flatpak needs a remote before it is useful: flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo");
  }

  // --- services
  const svcToEmit = selectedSvcs.filter((s) => !(proxyEngine && s.id === proxyEngine));
  if (svcToEmit.length) {
    openSection("Services");
    for (const s of svcToEmit) {
      const vars = varsFor(s);
      if (s.note) comment(`${s.name}: ${s.note}`);
      const ok = emit(pickNix(s).map((l) => substitute(l, vars)), `service:${s.id}`);
      if (ok) for (const sec of s.secrets || []) secrets.push({ ...sec, service: s.name });
    }
  }

  // --- reverse proxy
  if (proxyEngine) {
    const webSvcs = selectedSvcs.filter((s) => s.web && s.webPort && !s.ownsHttp);
    openSection("Reverse proxy");
    comment(
      `Every web service below is published as <name>.${state.proxy.baseDomain} over HTTPS.\n` +
      "Point those DNS names at this machine and make sure ports 80 and 443 are reachable,\n" +
      "or the certificate challenge will fail.",
    );
    if (proxyEngine === "caddy") {
      const lines = ["services.caddy = {", "  enable = true;"];
      if (state.proxy.email) lines.push(`  email = ${quote(state.proxy.email)};`);
      lines.push("  virtualHosts = {");
      for (const s of webSvcs) {
        lines.push(`    "${s.id.replace(/-srv$/, "")}.${state.proxy.baseDomain}".extraConfig = ''`);
        lines.push(`      reverse_proxy 127.0.0.1:${s.webPort}`);
        lines.push("    '';");
      }
      lines.push("  };", "};");
      emit(lines, "core:proxy", { force: true });
    } else {
      const lines = [
        "services.nginx = {",
        "  enable = true;",
        "  recommendedProxySettings = true;",
        "  recommendedTlsSettings = true;",
        "  recommendedGzipSettings = true;",
        "  virtualHosts = {",
      ];
      for (const s of webSvcs) {
        lines.push(`    "${s.id.replace(/-srv$/, "")}.${state.proxy.baseDomain}" = {`);
        lines.push("      forceSSL = true;");
        lines.push("      enableACME = true;");
        lines.push(`      locations."/".proxyPass = "http://127.0.0.1:${s.webPort}";`);
        lines.push("    };");
      }
      lines.push("  };", "};");
      emit(lines, "core:proxy", { force: true });
      emit([
        "security.acme = {",
        "  acceptTerms = true;",
        `  defaults.email = ${quote(state.proxy.email || "you@example.com")};`,
        "};",
      ], "core:acme");
    }
    if (!webSvcs.length) comment("No web services are selected yet, so there is nothing to proxy.");
    else notes.push("Web services are reachable through the proxy only - their own ports are left closed in the firewall.");
    notes.push(`The reverse proxy replaces the standalone ${proxyEngine} service entry, which is why that block is not repeated below.`);
  }

  // --- security
  const securityToggles = selectedToggles.filter(
    (t) => t.nix?.length && !["firewall", "hardened-kernel"].includes(t.id),
  );
  if (securityToggles.length) {
    openSection("Security");
    const level = cat.security.levels.find((l) => l.id === state.security);
    if (level) comment(`Profile: ${level.name} - ${level.desc}`);
    for (const t of securityToggles) {
      if (t.warn) comment(`${t.name}: ${t.warn}`);
      emit(pickNix(t), `security:${t.id}`);
    }
  }

  // --- nix settings
  openSection("Nix");
  if (isFlake)
    emit([`nix.settings.experimental-features = [ "nix-command" "flakes" ];`], "core:nix-features");
  if (state.opts.optimise) {
    emit(["nix.settings.auto-optimise-store = true;"], "core:nix-optimise");
    emit([
      "nix.gc = {",
      "  automatic = true;",
      '  dates = "weekly";',
      '  options = "--delete-older-than 30d";',
      "};",
    ], "core:nix-gc");
  }
  if (needsUnfree) {
    comment(`Required by: ${[...new Set(unfree)].sort().join(", ")}`);
    emit(["nixpkgs.config.allowUnfree = true;"], "core:unfree");
  }

  openSection("State version");
  comment(
    "The release this machine was FIRST installed with. It is not a version to\n" +
    "keep current - changing it can migrate stateful services incorrectly.",
  );
  emit([`system.stateVersion = ${quote(release)};`], "core:stateversion");

  // ---- render ---------------------------------------------------------------
  const body = [];
  for (const s of sections) {
    if (!s.lines.length) continue;
    if (s.title) {
      body.push("");
      body.push(header(s.title));
    }
    body.push(...s.lines);
  }
  const configuration = [...banner, ...body, "}", ""].join("\n");

  // ==========================================================================
  // flake.nix
  // ==========================================================================
  const files = [];
  if (isFlake) files.push({ name: "flake.nix", lang: "nix", content: renderFlake() });
  files.push({ name: "configuration.nix", lang: "nix", content: configuration });

  const hm = selectedFlakes.find((f) => f.producesHome);
  if (hm) files.push({ name: "home.nix", lang: "nix", content: renderHome() });

  function renderFlake() {
    const nixpkgsUrl =
      state.meta.channel === "unstable"
        ? "github:NixOS/nixpkgs/nixos-unstable"
        : `github:NixOS/nixpkgs/nixos-${state.meta.channel}`;
    const L = [];
    L.push(`{`);
    L.push(`  description = "NixOS configuration for ${host}";`);
    L.push("");
    L.push("  inputs = {");
    L.push(`    nixpkgs.url = "${nixpkgsUrl}";`);
    for (const f of selectedFlakes) {
      const url = substitute((f.urlByChannel && f.urlByChannel[state.meta.channel]) || f.url, baseVars);
      L.push("");
      if (f.note) L.push(`    # ${f.note}`);
      if (f.follows) {
        L.push(`    ${f.id} = {`);
        L.push(`      url = "${url}";`);
        L.push(`      inputs.nixpkgs.follows = "nixpkgs";`);
        L.push(`    };`);
      } else {
        L.push(`    ${f.id}.url = "${url}";`);
      }
    }
    L.push("  };");
    L.push("");
    L.push("  outputs = inputs@{ self, nixpkgs, ... }: {");
    L.push(`    nixosConfigurations.${host} = nixpkgs.lib.nixosSystem {`);
    L.push(`      system = "${state.meta.system}";`);
    L.push("      specialArgs = { inherit inputs; };");
    L.push("      modules = [");
    L.push("        ./configuration.nix");
    for (const f of selectedFlakes) if (f.module) L.push(`        inputs.${f.module}`);
    for (const f of selectedFlakes)
      if (f.config?.length) {
        L.push("        {");
        for (const l of f.config) L.push(`          ${substitute(l, baseVars)}`);
        L.push("        }");
      }
    L.push("      ];");
    L.push("    };");
    L.push("  };");
    L.push("}");
    L.push("");
    return L.join("\n");
  }

  function renderHome() {
    return [
      "# Home Manager configuration for " + user + ".",
      "# Applied by the same `nixos-rebuild switch` as the system config.",
      "",
      "{ config, pkgs, ... }:",
      "",
      "{",
      `  home.username = ${quote(user)};`,
      `  home.homeDirectory = ${quote("/home/" + user)};`,
      "",
      "  # Same rule as system.stateVersion: set once, then leave it alone.",
      `  home.stateVersion = ${quote(release)};`,
      "",
      "  programs.home-manager.enable = true;",
      "",
      "  # Packages that belong to you rather than to the whole machine.",
      "  home.packages = with pkgs; [ ];",
      "",
      "  programs.git = {",
      "    enable = true;",
      `    # userName = ${quote(state.meta.fullName || "Your Name")};`,
      '    # userEmail = "you@example.com";',
      "  };",
      "}",
      "",
    ].join("\n");
  }

  // ---- stats ----------------------------------------------------------------
  const byCat = new Map();
  for (const p of selectedPkgs) byCat.set(p.cat, (byCat.get(p.cat) || 0) + 1);
  if (extraPkgs.length) byCat.set("search", extraPkgs.length);

  const stats = {
    packages: selectedPkgs.length + extraPkgs.length,
    catalogPackages: selectedPkgs.length,
    searchPackages: extraPkgs.length,
    modulePackages: modulePkgs.length,
    fonts: fontPkgs.length,
    desktopExtras: desktop.packages?.length || 0,
    byCategory: [...byCat.entries()].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n),
    services: selectedSvcs.length,
    webServices: selectedSvcs.filter((s) => s.web).length,
    flakeInputs: selectedFlakes.length,
    securityToggles: on.size,
    unfree: [...new Set(unfree)].sort(),
    tcpPorts: [...tcp].sort((a, b) => a - b),
    udpPorts: [...udp].sort((a, b) => a - b),
    lines: configuration.split("\n").length,
    bytes: files.reduce((n, f) => n + f.content.length, 0),
    channel: chan.name,
    release,
  };

  for (const d of dropped)
    notes.push(`Skipped a ${d.owner} block: it sets ${d.path}, already set by ${d.clashesWith}.`);

  return { files, stats, notes, secrets, dropped, unfree: stats.unfree };
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function displayManager(dm, desktop, channel) {
  switch (dm) {
    case "gdm":
      // The `wayland` option was dropped after 25.11; GDM decides for itself now.
      return channel === "25.11"
        ? ["services.displayManager.gdm = {", "  enable = true;", "  wayland = true;", "};"]
        : ["services.displayManager.gdm.enable = true;"];
    case "sddm":
      return ["services.displayManager.sddm = {", "  enable = true;", `  wayland.enable = ${!!desktop.wayland};`, "};"];
    case "lightdm":
    case "lightdm-pantheon":
      return ["services.xserver.displayManager.lightdm.enable = true;"];
    case "cosmic-greeter":
      return ["services.displayManager.cosmic-greeter.enable = true;"];
    case "greetd":
      return [
        "services.greetd = {",
        "  enable = true;",
        "  settings.default_session = {",
        `    command = "\${pkgs.greetd.tuigreet}/bin/tuigreet --time --remember --cmd ${desktop.session || "sway"}";`,
        '    user = "greeter";',
        "  };",
        "};",
      ];
    case "none":
    default:
      return [];
  }
}
