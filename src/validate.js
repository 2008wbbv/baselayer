// Checks a configuration for combinations that build but do not work, or that
// work but will surprise you later. Returns findings ordered by severity.
//
// level: "error"   - this will not evaluate, or will certainly break the machine
//        "warning" - it will build, but something you selected will not work
//        "info"    - worth knowing before you rebuild

import { activeToggles } from "./state.js";

const ERROR = "error";
const WARNING = "warning";
const INFO = "info";

export function validate(state, cat, result) {
  const out = [];
  const add = (level, title, detail, fix) => out.push({ level, title, detail, fix });

  const byId = (list) => new Map(list.map((x) => [x.id, x]));
  const svcById = byId(cat.services.items);
  const pkgById = byId(cat.packages.items);
  const toggleById = byId(cat.security.toggles);

  const svcs = state.services.map((id) => svcById.get(id)).filter(Boolean);
  const pkgs = state.packages.map((id) => pkgById.get(id)).filter(Boolean);
  const on = activeToggles(state, cat.security);
  const desktop = cat.desktops.items.find((d) => d.id === state.desktop);
  const gpu = cat.hardware.gpu.find((g) => g.id === state.gpu);

  // --- identity ------------------------------------------------------------
  if (!/^[a-z_][a-z0-9_-]*$/.test(state.meta.username))
    add(ERROR, "Username is not valid",
      `"${state.meta.username}" will be rejected. Linux usernames start with a lowercase letter or underscore and contain only lowercase letters, digits, hyphens and underscores.`,
      "Pick a simpler username on the Basics step.");
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(state.meta.hostname))
    add(ERROR, "Hostname is not valid",
      `"${state.meta.hostname}" is not a valid hostname. Use letters, digits and hyphens, and do not start or end with a hyphen.`,
      "Fix the hostname on the Basics step.");

  let tzOk = true;
  try { new Intl.DateTimeFormat("en", { timeZone: state.meta.timezone }); } catch { tzOk = false; }
  if (!tzOk)
    add(ERROR, "Time zone is not recognised",
      `"${state.meta.timezone}" is not an IANA zone name, so time.timeZone will fail to evaluate.`,
      "Pick one from the suggestions on the Basics step, e.g. Europe/London.");

  // --- kernel vs hardware --------------------------------------------------
  if (on.has("hardened-kernel")) {
    if (gpu && gpu.id.startsWith("nvidia"))
      add(ERROR, "Hardened kernel cannot build the NVIDIA driver",
        "The linux-hardened patch set does not carry the symbols the proprietary NVIDIA module needs, so the rebuild will fail.",
        "Turn off the hardened kernel, or switch the GPU to the open amdgpu or Intel driver.");
    if (state.filesystem === "zfs")
      add(ERROR, "Hardened kernel and ZFS do not mix",
        "ZFS builds out-of-tree modules against a specific kernel and does not support linux-hardened.",
        "Turn off the hardened kernel, or use Btrfs or ext4.");
    if (pkgs.some((p) => p.id === "steam") || state.opts.gaming)
      add(WARNING, "Gaming on a hardened kernel will be slow",
        "The hardened kernel disables optimisations and costs noticeable frame rate, and anti-cheat systems often refuse to run under it.",
        "Use the Relaxed or Baseline profile on a gaming machine.");
    if (svcs.some((s) => s.id === "postgresql") || pkgs.some((p) => p.id === "docker"))
      add(WARNING, "Containers and databases may misbehave on the hardened kernel",
        "Docker needs kernel features the hardened profile restricts, and some database engines rely on large pages and ptrace.",
        "Test before you depend on it, or drop to the Hardened profile without the hardened kernel.");
  }

  if (on.has("lock-kernel-modules")) {
    if (gpu && gpu.id.startsWith("nvidia"))
      add(WARNING, "Locked kernel modules can break the NVIDIA driver",
        "If the NVIDIA module is not loaded during early boot, it can never be loaded afterwards and you get a black screen.",
        "Leave module locking off on machines with an NVIDIA card.");
    if (pkgs.some((p) => ["virt-manager", "waydroid", "qemu"].includes(p.id)))
      add(WARNING, "Locked kernel modules break virtualisation",
        "KVM, vboxdrv and the Waydroid binder modules are loaded on demand, which module locking prevents.",
        "Turn off module locking if you run virtual machines.");
  }

  if (on.has("disable-smt"))
    add(INFO, "SMT is disabled",
      "Hyper-Threading is off, which removes a class of side-channel attacks and roughly a third of your multi-threaded performance.",
      null);

  // --- desktop -------------------------------------------------------------
  if (desktop && desktop.id === "none" && state.loginManager !== "auto" && state.loginManager !== "none")
    add(WARNING, "A display manager without a desktop",
      "You picked a login screen but no desktop for it to start.",
      "Choose a desktop, or set the login manager back to None.");

  if (desktop && desktop.kind === "wm" && !desktop.wayland && state.loginManager === "greetd")
    add(INFO, "greetd with an X11 window manager",
      `greetd is a text login. It can start ${desktop.name}, but LightDM is the more usual pairing for X11.`,
      null);

  if (desktop && desktop.channels && !desktop.channels.includes(state.meta.channel))
    add(WARNING, `${desktop.name} is only packaged on ${desktop.channels.join(", ")}`,
      `The module may not exist on ${state.meta.channel} and the rebuild would fail.`,
      `Switch the channel to ${desktop.channels[0]}, or pick another desktop.`);

  if (state.opts.autoLogin && desktop && desktop.id !== "none")
    add(INFO, "Automatic login is on",
      "Anyone with physical access reaches your session without a password. Disk encryption is unaffected.",
      null);

  if (state.opts.autoLogin && on.has("ssh-hardening") && state.net.ssh)
    add(INFO, "Automatic login next to hardened SSH",
      "Remote access is locked down while local access is open. That is a deliberate trade-off worth being aware of.",
      null);

  // --- gaming --------------------------------------------------------------
  if (pkgs.some((p) => p.needs32bit) && gpu && gpu.id === "none")
    add(WARNING, "32-bit games with no graphics driver",
      "Steam and Wine need 32-bit graphics libraries, and no GPU driver is selected.",
      "Pick the GPU that matches the machine.");

  // --- services ------------------------------------------------------------
  const portOwners = new Map();
  for (const s of svcs)
    for (const p of s.ports?.tcp || []) {
      if (portOwners.has(p))
        add(ERROR, `Port ${p} is claimed twice`,
          `${portOwners.get(p)} and ${s.name} both listen on TCP ${p}. One of them will fail to start.`,
          "Change the port on one of them, or drop one.");
      else portOwners.set(p, s.name);
    }

  for (const s of svcs) {
    for (const need of s.needs || [])
      if (!state.services.includes(need))
        add(ERROR, `${s.name} needs ${svcById.get(need)?.name || need}`,
          `${s.name} is configured to talk to ${svcById.get(need)?.name || need}, which is not enabled.`,
          `Add ${svcById.get(need)?.name || need} on the Services step.`);
    for (const c of s.conflicts || []) {
      if (state.services.includes(c))
        add(WARNING, `${s.name} and ${svcById.get(c)?.name || c} overlap`,
          "These two do the same job and will compete for ports and data directories.",
          "Keep one.");
      if (on.has(c) && toggleById.get(c))
        add(WARNING, `${s.name} conflicts with "${toggleById.get(c).name}"`,
          `${s.name} wants to own that part of the system, and the security toggle configures it differently.`,
          `Turn off "${toggleById.get(c).name}" on the Security step.`);
    }
  }

  const httpOwners = svcs.filter((s) => s.ownsHttp);
  if (httpOwners.length > 1)
    add(ERROR, "More than one service wants port 80",
      `${httpOwners.map((s) => s.name).join(" and ")} each set up their own web server on port 80. Only one can bind it.`,
      "Keep one, or put the others behind the reverse proxy.");

  if (state.proxy.enabled) {
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(state.proxy.baseDomain || ""))
      add(ERROR, "The reverse proxy needs a real domain",
        `"${state.proxy.baseDomain}" is not a domain name that a certificate authority will issue for.`,
        "Use a domain you control, e.g. home.example.com.");
    else if (/\.(local|lan|home|internal)$/i.test(state.proxy.baseDomain))
      add(WARNING, "Certificates cannot be issued for that domain",
        `Let's Encrypt will not issue for "${state.proxy.baseDomain}" because it is not a public name.`,
        "Use a real domain with DNS-01, or turn the proxy off and reach services by port.");
    if (state.proxy.engine === "nginx" && !state.proxy.email)
      add(WARNING, "ACME has no contact address",
        "nginx with enableACME needs security.acme.defaults.email set, or the rebuild will fail an assertion.",
        "Add an email address on the Services step.");
    if (!svcs.some((s) => s.web && !s.ownsHttp))
      add(INFO, "Nothing to proxy yet",
        "The reverse proxy is on but no web service is selected, so it will serve nothing.",
        null);
  }

  const dnsSvcs = svcs.filter((s) => (s.ports?.udp || []).includes(53));
  if (dnsSvcs.length && on.has("dns-over-tls"))
    add(WARNING, `${dnsSvcs[0].name} and encrypted DNS both want port 53`,
      "systemd-resolved binds 127.0.0.53:53 and the DNS server wants the same port on the same host.",
      `Turn off "DNS over TLS" on the Security step and configure encrypted upstreams inside ${dnsSvcs[0].name} instead.`);

  if (svcs.some((s) => s.id === "samba") && on.has("blacklist-fs-modules"))
    add(INFO, "Legacy filesystem modules are blacklisted",
      "Samba itself is fine, but clients will not be able to mount optical media shared from this machine.",
      null);

  // --- exposure ------------------------------------------------------------
  if (!on.has("firewall") && result?.stats?.services)
    add(WARNING, "The firewall is off with services running",
      "Every port your services listen on is reachable from the whole network.",
      "Turn the firewall back on in the Security step.");

  if (state.net.ssh && !on.has("ssh-hardening"))
    add(WARNING, "SSH accepts passwords",
      "Password authentication is on, which is the single most common way a home server is taken over.",
      'Turn on "SSH: keys only, no root" and add your public key.');

  const exposed = (result?.stats?.tcpPorts || []).filter((p) => p !== 22);
  if (exposed.length > 10)
    add(INFO, `${exposed.length} TCP ports are open`,
      "That is a wide surface if this machine is reachable from the internet. On a LAN it is usually fine.",
      "A reverse proxy would reduce this to ports 80 and 443.");

  if (svcs.some((s) => s.id === "vaultwarden") && !state.proxy.enabled)
    add(WARNING, "Vaultwarden without HTTPS",
      "The Bitwarden browser extensions and mobile apps refuse to connect over plain HTTP.",
      "Turn on the reverse proxy, or terminate TLS somewhere else.");

  // --- secrets -------------------------------------------------------------
  const secretCount = result?.secrets?.length || 0;
  if (secretCount)
    add(INFO, `${secretCount} secret file${secretCount > 1 ? "s" : ""} must exist before the first rebuild`,
      "Some services refuse to start without a password or key file that cannot be committed to a config.",
      state.flakes.includes("sops-nix") || state.flakes.includes("agenix")
        ? "You have a secrets manager selected, which is the tidier way to handle these."
        : "The review step lists the exact commands, or add sops-nix to manage them declaratively.");

  // --- licences ------------------------------------------------------------
  if (result?.stats?.unfree?.length)
    add(INFO, `${result.stats.unfree.length} unfree package${result.stats.unfree.length > 1 ? "s" : ""}`,
      `nixpkgs.config.allowUnfree is set because of: ${result.stats.unfree.join(", ")}.`,
      null);

  // --- flakes --------------------------------------------------------------
  if (state.meta.format === "flake" && state.flakes.length) {
    const ids = new Set(state.flakes);
    for (const f of cat.flakes.items) {
      if (!ids.has(f.id)) continue;
      for (const c of f.conflicts || [])
        if (ids.has(c))
          add(WARNING, `${f.name} and ${cat.flakes.items.find((x) => x.id === c)?.name} do the same job`,
            "Running two secret managers side by side works but is confusing.",
            "Keep one.");
      if (f.requiresFirmware && state.firmware !== f.requiresFirmware)
        add(ERROR, `${f.name} requires ${f.requiresFirmware.toUpperCase()}`,
          `It cannot work with the ${state.firmware} boot setup you selected.`,
          `Switch the firmware to ${f.requiresFirmware.toUpperCase()}, or remove ${f.name}.`);
      if (f.requires?.includes("flatpak") && !state.opts.flatpak)
        add(WARNING, `${f.name} needs Flatpak enabled`,
          "The module declares Flatpak applications but the Flatpak service is off.",
          "Turn on Flatpak in Desktop extras.");
    }
  }
  if (state.meta.format === "classic" && state.flakes.length)
    add(INFO, "Flake inputs are ignored in classic mode",
      "You selected extra GitHub inputs, but a plain configuration.nix has no way to pull them in.",
      "Switch the output format to Flake to use them.");

  // --- generator feedback ---------------------------------------------------
  for (const d of result?.dropped || [])
    add(WARNING, "Two features set the same option",
      `The ${d.owner} block was left out because it sets ${d.path}, which ${d.clashesWith} already sets.`,
      "Remove one of the two so nothing is silently dropped.");

  const rank = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
